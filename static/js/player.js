/* One player for the whole site.

   The audio element lives in this document rather than in a resource row, so
   every page can show the same now-playing bar. The last track is kept in
   sessionStorage as a hand-off for a normal page navigation: the next page
   recreates the player, restores its position and attempts to continue it.

   The contract is one attribute. Any button carrying `data-play-src` becomes
   a play/pause toggle for that file; `data-play-name` is what the bar shows.
   The bar itself is always available, even on pages without a play button, so
   a track started on the home page remains controllable in every section. */
(function () {
    const {
        clearPlayerState,
        readPlayerState,
        shouldClearOnPageHide,
        writePlayerState,
    } = window.ESDocPlayerState || {};

    if (!clearPlayerState || !readPlayerState || !shouldClearOnPageHide || !writePlayerState) return;

    let volumeStorage = null;
    let playerStorage = null;
    try { volumeStorage = localStorage; } catch (error) {}
    try { playerStorage = sessionStorage; } catch (error) {}

    let buttons = [];

    let status = document.getElementById('res-copy-status');
    if (!status) {
        status = document.createElement('p');
        status.className = 'sr-only';
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        document.body.appendChild(status);
    }

    const audio = new Audio();
    audio.preload = 'none';
    let storedVolume = 1;
    try { storedVolume = parseFloat(volumeStorage?.getItem('es-doc-volume') ?? '1'); } catch (error) {}
    audio.volume = Number.isFinite(storedVolume) ? Math.min(Math.max(storedVolume, 0), 1) : 1;

    let current = null;
    let currentSrc = '';
    let currentName = '';
    let localTrack = null;
    let localRepeat = 'off';
    let resumeTime = 0;
    let finished = false;

    const bar = document.createElement('div');
    bar.className = 'res-nowplaying';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Сейчас играет');
    bar.innerHTML =
        '<button type="button" class="res-nowplaying-pause" aria-label="Пауза">' +
        window.ESDocIcons.svg('pause', 16) +
        window.ESDocIcons.svg('play', 16) + '</button>' +
        '<button type="button" class="res-nowplaying-stop" aria-label="Остановить">' +
        window.ESDocIcons.svg('square', 16) + '</button>' +
        '<div class="res-nowplaying-main"><span class="res-nowplaying-name"></span>' +
        '<div class="res-seek"><span class="res-time" data-current>0:00</span>' +
        '<input type="range" min="0" max="0" step="0.1" value="0" aria-label="Позиция воспроизведения">' +
        '<span class="res-time" data-duration>0:00</span></div></div>' +
        '<button type="button" class="res-nowplaying-repeat" aria-label="Повтор выключен" aria-pressed="false" title="Повторить произведение">' +
        window.ESDocIcons.svg('repeat', 18) + '</button>' +
        '<label class="res-volume">' + window.ESDocIcons.svg('volume-2', 18) +
        '<input type="range" min="0" max="1" step="0.05" aria-label="Громкость прослушивания"></label>';
    document.body.appendChild(bar);

    const barName = bar.querySelector('.res-nowplaying-name');
    const barVolume = bar.querySelector('.res-volume input');
    const seek = bar.querySelector('.res-seek input');
    const timeNow = bar.querySelector('[data-current]');
    const timeAll = bar.querySelector('[data-duration]');
    const pause = bar.querySelector('.res-nowplaying-pause');
    const repeat = bar.querySelector('.res-nowplaying-repeat');

    const fmt = seconds => {
        if (!isFinite(seconds)) return '--:--';
        const value = Math.round(seconds) || 0;
        return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
    };

    const setFill = input => {
        const min = parseFloat(input.min) || 0;
        const max = parseFloat(input.max) || 0;
        const value = parseFloat(input.value) || 0;
        const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
        input.style.setProperty('--range-pct', pct + '%');
    };

    const setButtonState = (button, playing) => {
        if (!button) return;
        button.setAttribute('aria-pressed', playing ? 'true' : 'false');
        button.setAttribute('aria-label', playing ? 'Пауза' :
            (button.dataset.playLabel || `Прослушать ${button.dataset.playName || 'аудиофайл'}`));
    };

    const repeatLabels = { off: 'Повтор выключен', track: 'Повтор трека', queue: 'Повтор очереди' };
    const setRepeat = mode => {
        const enabled = mode !== 'off';
        audio.loop = mode === 'track';
        repeat.setAttribute('aria-pressed', enabled ? 'true' : 'false');
        const label = localTrack ? repeatLabels[mode] : enabled ? 'Повтор включён' : repeatLabels.off;
        repeat.setAttribute('aria-label', label);
        repeat.title = localTrack ? label : enabled ? 'Выключить повтор' : 'Повторить произведение';
        repeat.innerHTML = window.ESDocIcons.svg(localTrack && mode === 'track' ? 'repeat-1' : 'repeat', 18);
    };

    const persist = (playing = !audio.paused, time = audio.currentTime) => {
        if (!currentSrc || localTrack) return;
        writePlayerState(playerStorage, {
            src: currentSrc,
            name: currentName,
            time: Number.isFinite(time) && time >= 0 ? time : 0,
            playing,
            repeat: audio.loop,
        });
    };

    const applyDuration = () => {
        if (!isFinite(audio.duration)) return;
        seek.max = audio.duration;
        timeAll.textContent = fmt(audio.duration);
        setFill(seek);
        if (resumeTime > 0) {
            audio.currentTime = Math.min(resumeTime, audio.duration || resumeTime);
            resumeTime = 0;
        }
    };

    audio.addEventListener('loadedmetadata', () => {
        applyDuration();
        if (!isFinite(audio.duration)) {
            const resume = audio.currentTime;
            audio.currentTime = 1e101;
            audio.addEventListener('seeked', function restoreAfterProbe() {
                audio.removeEventListener('seeked', restoreAfterProbe);
                audio.currentTime = resume;
            }, { once: true });
        }
    });
    audio.addEventListener('durationchange', applyDuration);

    audio.addEventListener('timeupdate', () => {
        if (!seek.matches(':active')) {
            seek.value = audio.currentTime;
            setFill(seek);
        }
        timeNow.textContent = fmt(audio.currentTime);
        persist(!audio.paused);
    });

    seek.addEventListener('input', () => {
        audio.currentTime = +seek.value;
        timeNow.textContent = fmt(+seek.value);
        setFill(seek);
        persist(!audio.paused);
    });

    const setVolume = value => {
        const volume = Math.min(Math.max(value, 0), 1);
        audio.volume = volume;
        try { volumeStorage?.setItem('es-doc-volume', String(volume)); } catch (error) {}
        barVolume.value = volume;
        setFill(barVolume);
    };
    setVolume(audio.volume);
    barVolume.addEventListener('input', () => setVolume(parseFloat(barVolume.value)));

    const stop = () => {
        if (current && bar.contains(document.activeElement)) current.focus();
        bar.classList.remove('res-nowplaying--visible', 'res-nowplaying--ended', 'res-nowplaying--local');
        setButtonState(current, false);
        current = null;
        currentSrc = '';
        currentName = '';
        resumeTime = 0;
        finished = false;
        audio.pause();
        if (localTrack) {
            localTrack = null;
            audio.removeAttribute('src');
            audio.load();
        }
        clearPlayerState(playerStorage);
    };

    const finish = () => {
        if (!currentSrc || audio.loop) return;
        if (localTrack?.advance(localRepeat === 'queue')) return;
        finished = true;
        audio.currentTime = 0;
        setButtonState(current, false);
        pause.setAttribute('aria-label', 'Продолжить');
        bar.classList.add('res-nowplaying--paused', 'res-nowplaying--ended', 'res-nowplaying--visible');
        timeNow.textContent = '0:00';
        persist(false, 0);
        status.textContent = 'Произведение завершено. Панель плеера остаётся открытой.';
    };

    audio.addEventListener('ended', finish);
    audio.addEventListener('error', () => {
        if (!audio.error) return;
        localTrack?.onError();
        stop();
    });
    bar.querySelector('.res-nowplaying-stop').addEventListener('click', () => {
        if (bar.contains(document.activeElement)) localTrack?.restoreFocus();
        stop();
    });

    const togglePlayback = () => {
        if (audio.paused) {
            if (finished) { audio.currentTime = 0; finished = false; }
            audio.play().catch(() => {});
        } else {
            audio.pause();
        }
    };
    pause.addEventListener('click', togglePlayback);

    repeat.addEventListener('click', () => {
        if (localTrack) {
            localRepeat = { off: 'track', track: 'queue', queue: 'off' }[localRepeat];
            setRepeat(localRepeat);
        } else {
            setRepeat(audio.loop ? 'off' : 'track');
        }
        persist(!audio.paused);
    });

    audio.addEventListener('pause', () => {
        if (!currentSrc || !audio.paused) return;
        bar.classList.add('res-nowplaying--paused');
        pause.setAttribute('aria-label', 'Продолжить');
        setButtonState(current, false);
        if (!finished) persist(false);
        status.textContent = 'Пауза.';
    });

    audio.addEventListener('play', () => {
        if (!currentSrc || audio.paused) return;
        finished = false;
        bar.classList.remove('res-nowplaying--paused', 'res-nowplaying--ended');
        pause.setAttribute('aria-label', 'Пауза');
        setButtonState(current, true);
        persist(true);
        status.textContent = 'Воспроизведение: ' + (barName.textContent || '') + '.';
    });

    const startTrack = (src, name, button = null, track = null) => {
        stop();
        current = button;
        currentSrc = src;
        currentName = name;
        localTrack = track;
        barName.textContent = currentName;
        barName.title = currentName;
        seek.value = 0;
        seek.max = 0;
        setFill(seek);
        timeNow.textContent = timeAll.textContent = '0:00';
        setRepeat(track ? localRepeat : 'off');
        if (track) bar.classList.add('res-nowplaying--local');
        pause.setAttribute('aria-label', 'Воспроизвести');
        bar.classList.add('res-nowplaying--visible', 'res-nowplaying--paused');
        audio.src = currentSrc;
        audio.play().catch(error => {
            if (track && localTrack === track && error.name === 'NotAllowedError') {
                status.textContent = 'Нажмите кнопку воспроизведения в плеере.';
            }
        });
    };

    // Local previews own their object URLs and release them after stopping playback.
    window.ESDocPlayer = {
        playLocal: track => startTrack(track.src, track.name, null, track),
        stopLocal: src => {
            if (localTrack?.src === src) stop();
        },
    };

    const bindButtons = () => {
        document.querySelectorAll('[data-player-fallback]').forEach(el => el.remove());
        buttons = [...document.querySelectorAll('[data-play-src]')];

        buttons.forEach(button => {
            if (button.dataset.playerBound) return;
            button.dataset.playerBound = '1';
            button.hidden = false;
            button.addEventListener('click', () => {
                if (current === button) {
                    togglePlayback();
                    return;
                }
                startTrack(button.dataset.playSrc, button.dataset.playName || '', button);
            });
        });
    };

    bindButtons();

    const saved = readPlayerState(playerStorage);
    if (saved) {
        current = buttons.find(button => button.dataset.playSrc === saved.src) || null;
        currentSrc = saved.src;
        currentName = saved.name;
        barName.textContent = currentName;
        resumeTime = saved.time;
        setRepeat(saved.repeat ? 'track' : 'off');
        bar.classList.add('res-nowplaying--visible');
        audio.src = saved.src;
        if (saved.playing) audio.play().catch(() => persist(false, saved.time));
        else audio.pause();
    }

    window.addEventListener('esdoc:navigation', () => {
        const previousSrc = currentSrc;
        bindButtons();
        current = buttons.find(button => button.dataset.playSrc === previousSrc) || null;
        setButtonState(current, !audio.paused);
    });

    window.addEventListener('pagehide', event => {
        // A real reload or hard navigation must not resurrect a running
        // player on the next document. Keep state only for a bfcache restore;
        // soft in-site navigation never reaches pagehide and keeps this Audio
        // object alive without a gap (especially important in Firefox).
        if (shouldClearOnPageHide(event)) {
            audio.pause();
            clearPlayerState(playerStorage);
        } else {
            persist(!audio.paused);
        }
    });
})();
