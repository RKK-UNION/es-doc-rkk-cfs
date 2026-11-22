import unittest
from unittest.mock import patch

from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient
from starlette.responses import PlainTextResponse, StreamingResponse

from app.app import app


class ErrorFallbackTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        # Reuse the production handlers without adding test routes to the site.
        self.app = FastAPI(exception_handlers=app.exception_handlers)

        @self.app.get('/unhandled')
        async def unhandled():
            raise RuntimeError('private exception details')

        @self.app.get('/handled/{status}')
        async def handled(status: int):
            raise HTTPException(status)

        @self.app.get('/upstream-failure')
        async def upstream_failure():
            return PlainTextResponse('Application recovery message', status_code=502)

        @self.app.get('/stream')
        async def stream():
            async def chunks():
                yield b'already started'
                raise RuntimeError('stream failed')
            return StreamingResponse(chunks())

    async def get(self, path):
        async with AsyncClient(
            transport=ASGITransport(app=self.app, raise_app_exceptions=False),
            base_url='http://test',
        ) as client:
            return await client.get(path)

    async def test_unhandled_exception_requests_nginx_fallback(self):
        response = await self.get('/unhandled')
        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.headers['x-accel-redirect'], '/_nginx/server-error')
        self.assertEqual(response.headers['cache-control'], 'no-store')
        self.assertEqual(response.text, 'Internal Server Error')

    async def test_handled_errors_keep_application_page(self):
        for status in (404, 500, 503):
            with self.subTest(status=status):
                response = await self.get(f'/handled/{status}')
                self.assertEqual(response.status_code, status)
                self.assertNotIn('x-accel-redirect', response.headers)
                self.assertIn('text/html', response.headers['content-type'])
                self.assertIn(f'Ошибка {status}', response.text)

    async def test_explicit_502_keeps_application_response(self):
        response = await self.get('/upstream-failure')
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.text, 'Application recovery message')
        self.assertNotIn('x-accel-redirect', response.headers)

    async def test_broken_error_template_requests_nginx_fallback(self):
        with patch('app.app.templates.TemplateResponse', side_effect=RuntimeError('template failed')):
            response = await self.get('/handled/500')
        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.headers['x-accel-redirect'], '/_nginx/server-error')

    async def test_started_response_is_not_replaced(self):
        response = await self.get('/stream')
        self.assertEqual(response.status_code, 200)
        self.assertNotIn('x-accel-redirect', response.headers)


if __name__ == '__main__':
    unittest.main()
