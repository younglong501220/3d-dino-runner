import { useCallback, useEffect, useRef, useState } from 'react';
import { CloudLightning, CloudRain, Pause, Play, Sun, Sunset, Volume2, VolumeX } from 'lucide-react';
import {
  DinoGameEngine,
  GameOverSnapshot,
  GameState,
  HudSnapshot,
  WeatherType,
} from './game/DinoGameEngine';

const WEATHER_LABELS: Record<WeatherType, string> = {
  CLEAR: '晴朗',
  SUNSET: '黃昏',
  RAIN: '細雨',
  STORM: '雷雨',
};

function WeatherIcon({ weather }: { weather: WeatherType }) {
  switch (weather) {
    case 'SUNSET':
      return <Sunset className="h-3.5 w-3.5 text-rose-300" />;
    case 'RAIN':
      return <CloudRain className="h-3.5 w-3.5 text-sky-300" />;
    case 'STORM':
      return <CloudLightning className="h-3.5 w-3.5 text-amber-300" />;
    default:
      return <Sun className="h-3.5 w-3.5 text-amber-300" />;
  }
}

interface FloatingToast {
  id: number;
  text: string;
  variant: 'coin' | 'speed';
}

export default function App() {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<DinoGameEngine | null>(null);
  const toastIdRef = useRef(0);
  const toastTimersRef = useRef<number[]>([]);

  const [gameState, setGameState] = useState<GameState>('READY');
  const [showGameOverModal, setShowGameOverModal] = useState(false);
  const [hud, setHud] = useState<HudSnapshot>({
    score: 0,
    highScore: 0,
    speedMultiplier: '1.0x',
    boostProgress: 0,
    weather: 'CLEAR',
  });
  const [gameOverInfo, setGameOverInfo] = useState<GameOverSnapshot>({
    finalScore: 0,
    highScore: 0,
    isNewRecord: false,
  });
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [hasStartedOnce, setHasStartedOnce] = useState(false);
  const [contextLost, setContextLost] = useState(false);
  const [scorePopKey, setScorePopKey] = useState(0);
  const [speedPopKey, setSpeedPopKey] = useState(0);
  const [toasts, setToasts] = useState<FloatingToast[]>([]);

  const pushToast = useCallback((text: string, variant: 'coin' | 'speed') => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev.slice(-3), { id, text, variant }]);
    const timer = window.setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id));
      toastTimersRef.current = toastTimersRef.current.filter((t) => t !== timer);
    }, 800);
    toastTimersRef.current.push(timer);
  }, []);

  useEffect(() => {
    const mount = canvasMountRef.current;
    if (!mount) return;

    const engine = new DinoGameEngine(mount, {
      onStateChange: (nextState) => {
        setGameState(nextState);
        if (nextState !== 'GAMEOVER') {
          setShowGameOverModal(false);
        }
      },
      onHudUpdate: (snapshot) => {
        setHud(snapshot);
      },
      onCoinCollected: (bonus) => {
        setScorePopKey((k) => k + 1);
        pushToast(`+${bonus} 金幣加分!`, 'coin');
      },
      onSpeedBoost: () => {
        setSpeedPopKey((k) => k + 1);
        pushToast('速度提升 +10%!', 'speed');
      },
      onGameOver: (snapshot) => {
        setGameOverInfo(snapshot);
        setShowGameOverModal(true);
      },
      onSoundChange: (enabled) => {
        setSoundEnabled(enabled);
      },
      onFirstMove: () => {
        setHasStartedOnce(true);
      },
      onContextLost: (lost) => {
        setContextLost(lost);
      },
    });

    engineRef.current = engine;

    return () => {
      for (const timer of toastTimersRef.current) {
        window.clearTimeout(timer);
      }
      toastTimersRef.current = [];
      engine.dispose();
      engineRef.current = null;
    };
  }, [pushToast]);

  const handleStart = () => {
    engineRef.current?.startGame();
  };

  const handleTogglePause = () => {
    engineRef.current?.togglePause();
  };

  const handleResume = () => {
    engineRef.current?.resumeGame();
  };

  const handleToggleSound = () => {
    engineRef.current?.toggleSound();
  };

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#bfe3ff] text-slate-50">
      {/* Isolated WebGL Canvas Mount */}
      <div ref={canvasMountRef} className="fixed inset-0 z-0 h-full w-full" />

      {/* Top HUD Bar */}
      <header className="pointer-events-none fixed top-[max(14px,env(safe-area-inset-top))] right-[max(14px,env(safe-area-inset-right))] left-[max(14px,env(safe-area-inset-left))] z-10 flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <div
            key={`score-card-${scorePopKey}`}
            className={`flex min-w-[104px] flex-col rounded-2xl border border-white/20 bg-slate-900/75 px-4 py-2 shadow-lg sm:min-w-[116px] ${
              scorePopKey > 0 ? 'animate-pop-gold' : ''
            }`}
          >
            <span className="mb-0.5 text-[11px] font-bold tracking-wider text-slate-300">
              目前分數
            </span>
            <span className="font-mono-num text-xl leading-tight font-extrabold text-white sm:text-2xl">
              {hud.score}
            </span>
          </div>

          <div className="flex min-w-[104px] flex-col rounded-2xl border border-white/20 bg-slate-900/75 px-4 py-2 shadow-lg sm:min-w-[116px]">
            <span className="mb-0.5 text-[11px] font-bold tracking-wider text-slate-300">
              最高紀錄
            </span>
            <span className="font-mono-num text-xl leading-tight font-extrabold text-amber-400 sm:text-2xl">
              {hud.highScore}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div
            key={`speed-card-${speedPopKey}`}
            className={`flex min-w-[88px] flex-col rounded-2xl border border-white/20 bg-slate-900/75 px-3.5 py-2 shadow-lg sm:min-w-[98px] ${
              speedPopKey > 0 ? 'animate-pop-speed' : ''
            }`}
          >
            <div className="mb-0.5 flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold tracking-wider text-slate-300">
                速度倍率
              </span>
              <span className="flex items-center gap-1 text-[11px] font-semibold text-slate-200">
                <WeatherIcon weather={hud.weather} />
                {WEATHER_LABELS[hud.weather]}
              </span>
            </div>
            <span className="font-mono-num text-xl leading-tight font-extrabold text-white sm:text-2xl">
              {hud.speedMultiplier}
            </span>
            <div className="mt-1.5 h-1 w-full overflow-hidden rounded-sm bg-white/15">
              <div
                className="h-full bg-emerald-400 transition-transform duration-150 ease-out"
                style={{
                  transform: `scaleX(${hud.boostProgress})`,
                  transformOrigin: 'left center',
                }}
              />
            </div>
          </div>

          {(gameState === 'PLAYING' || gameState === 'PAUSED') && (
            <button
              type="button"
              onClick={handleTogglePause}
              aria-label={gameState === 'PAUSED' ? '繼續遊戲' : '暫停遊戲'}
              title={gameState === 'PAUSED' ? '繼續遊戲 (P)' : '暫停遊戲 (P)'}
              className="pointer-events-auto flex h-12 w-12 cursor-pointer items-center justify-center rounded-2xl border border-white/20 bg-slate-900/75 text-white shadow-lg transition-transform duration-150 hover:bg-slate-800/85 focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:outline-none active:scale-95"
            >
              {gameState === 'PAUSED' ? (
                <Play className="h-5 w-5 text-emerald-400" />
              ) : (
                <Pause className="h-5 w-5" />
              )}
            </button>
          )}

          <button
            type="button"
            onClick={handleToggleSound}
            aria-label={soundEnabled ? '關閉音效' : '開啟音效'}
            title={soundEnabled ? '關閉音效' : '開啟音效'}
            className="pointer-events-auto flex h-12 w-12 cursor-pointer items-center justify-center rounded-2xl border border-white/20 bg-slate-900/75 text-white shadow-lg transition-transform duration-150 hover:bg-slate-800/85 focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:outline-none active:scale-95"
          >
            {soundEnabled ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5 text-slate-400" />}
          </button>
        </div>
      </header>

      {/* Floating Score & Speed Boost Toasts */}
      <div className="pointer-events-none fixed inset-0 z-10 flex flex-col items-center justify-start gap-2 pt-24">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`animate-toast-pop rounded-xl border px-4 py-1.5 text-sm font-extrabold tracking-wide shadow-xl sm:text-base ${
              toast.variant === 'coin'
                ? 'border-yellow-200/90 bg-yellow-400/95 text-amber-950'
                : 'border-emerald-200/90 bg-emerald-500/95 text-emerald-950'
            }`}
          >
            {toast.text}
          </div>
        ))}
      </div>

      {/* WebGL Context Lost Notice */}
      {contextLost && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-950/80 p-6 text-center">
          <div className="max-w-sm rounded-2xl border border-white/20 bg-slate-900 p-6 shadow-2xl">
            <h2 className="mb-2 text-lg font-bold text-white">3D 畫面正在恢復中</h2>
            <p className="text-sm text-slate-300">偵測到顯示卡資源暫時中斷，系統將自動恢復遊戲畫面。</p>
          </div>
        </div>
      )}

      {/* Start Overlay */}
      {gameState === 'READY' && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-slate-950/40 p-5">
          <div className="w-full max-w-[420px] rounded-3xl border border-white/20 bg-slate-900/88 p-6 text-center shadow-2xl sm:p-7">
            <div className="mb-2 flex items-center justify-center gap-2 text-xs font-semibold tracking-wide text-emerald-300">
              <span>Three.js 3D 無盡跑酷</span>
              <span aria-hidden="true">·</span>
              <span>三跑道動作挑戰</span>
            </div>

            <h1 className="mb-2 text-3xl font-black tracking-tight text-white [text-wrap:balance] sm:text-[32px]">
              3D 方塊恐龍跑酷
            </h1>
            <p className="mb-5 text-sm leading-relaxed text-slate-300">
              收集 3D 黃色金幣方塊加 50 分！每 10 秒速度自動提升 10%，挑戰你的極限反應。
            </p>

            <div className="mb-6 flex flex-col gap-2.5 rounded-2xl border border-white/12 bg-white/5 p-4 text-left text-[13px] text-slate-200">
              <div className="flex items-center justify-between gap-2">
                <span>左右切換跑道</span>
                <div className="flex flex-wrap justify-end gap-1">
                  <kbd className="rounded-md border border-white/20 bg-white/10 px-2 py-0.5 text-[11px] font-bold text-white">
                    A / ←
                  </kbd>
                  <kbd className="rounded-md border border-white/20 bg-white/10 px-2 py-0.5 text-[11px] font-bold text-white">
                    D / →
                  </kbd>
                  <kbd className="rounded-md border border-white/20 bg-white/10 px-2 py-0.5 text-[11px] font-bold text-white">
                    左右滑動
                  </kbd>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span>跳躍閃避障礙</span>
                <div className="flex flex-wrap justify-end gap-1">
                  <kbd className="rounded-md border border-white/20 bg-white/10 px-2 py-0.5 text-[11px] font-bold text-white">
                    W / ↑ / Space
                  </kbd>
                  <kbd className="rounded-md border border-white/20 bg-white/10 px-2 py-0.5 text-[11px] font-bold text-white">
                    上滑
                  </kbd>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span>下蹲 / 空中急降</span>
                <div className="flex flex-wrap justify-end gap-1">
                  <kbd className="rounded-md border border-white/20 bg-white/10 px-2 py-0.5 text-[11px] font-bold text-white">
                    S / ↓
                  </kbd>
                  <kbd className="rounded-md border border-white/20 bg-white/10 px-2 py-0.5 text-[11px] font-bold text-white">
                    下滑
                  </kbd>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span>暫停遊戲</span>
                <div className="flex flex-wrap justify-end gap-1">
                  <kbd className="rounded-md border border-white/20 bg-white/10 px-2 py-0.5 text-[11px] font-bold text-white">
                    P / Esc
                  </kbd>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={handleStart}
              className="w-full cursor-pointer rounded-2xl bg-gradient-to-br from-emerald-400 to-green-500 px-6 py-3.5 text-lg font-extrabold tracking-wide text-emerald-950 shadow-lg shadow-emerald-500/35 transition-transform duration-150 hover:-translate-y-0.5 hover:shadow-emerald-500/50 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none active:scale-[0.98]"
            >
              開始奔跑
            </button>
          </div>
        </div>
      )}

      {/* Pause Menu Overlay */}
      {gameState === 'PAUSED' && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-slate-950/50 p-5">
          <div className="w-full max-w-[390px] rounded-3xl border border-white/20 bg-slate-900/92 p-6 text-center shadow-2xl sm:p-7">
            <div className="mb-2 text-xs font-extrabold tracking-widest text-sky-300">
              遊戲已暫停
            </div>

            <h2 className="mb-2 text-3xl font-black tracking-tight text-white">暫停選單</h2>
            <p className="mb-5 text-sm text-slate-300">
              調整呼吸節奏，隨時按 <kbd className="rounded border border-white/20 bg-white/10 px-1.5 py-0.5 text-xs font-bold text-white">P</kbd> 或 <kbd className="rounded border border-white/20 bg-white/10 px-1.5 py-0.5 text-xs font-bold text-white">Esc</kbd> 繼續奔跑。
            </p>

            <div className="mb-6 grid grid-cols-3 gap-2.5">
              <div className="rounded-2xl border border-white/15 bg-white/5 px-2.5 py-3">
                <div className="mb-1 text-[11px] font-semibold text-slate-300">目前分數</div>
                <div className="font-mono-num text-xl font-black text-white">{hud.score}</div>
              </div>
              <div className="rounded-2xl border border-white/15 bg-white/5 px-2.5 py-3">
                <div className="mb-1 text-[11px] font-semibold text-slate-300">速度倍率</div>
                <div className="font-mono-num text-xl font-black text-emerald-400">
                  {hud.speedMultiplier}
                </div>
              </div>
              <div className="rounded-2xl border border-white/15 bg-white/5 px-2.5 py-3">
                <div className="mb-1 text-[11px] font-semibold text-slate-300">目前天氣</div>
                <div className="flex items-center justify-center gap-1 pt-0.5 text-sm font-bold text-slate-100">
                  <WeatherIcon weather={hud.weather} />
                  <span>{WEATHER_LABELS[hud.weather]}</span>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={handleResume}
                className="w-full cursor-pointer rounded-2xl bg-gradient-to-br from-emerald-400 to-green-500 px-6 py-3.5 text-lg font-extrabold tracking-wide text-emerald-950 shadow-lg shadow-emerald-500/35 transition-transform duration-150 hover:-translate-y-0.5 hover:shadow-emerald-500/50 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none active:scale-[0.98]"
              >
                繼續遊戲
              </button>
              <button
                type="button"
                onClick={handleStart}
                className="w-full cursor-pointer rounded-2xl border border-white/20 bg-white/10 px-6 py-3 text-base font-bold text-white transition-colors duration-150 hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none active:scale-[0.98]"
              >
                重新開始
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Game Over Overlay */}
      {gameState === 'GAMEOVER' && showGameOverModal && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-slate-950/45 p-5">
          <div className="w-full max-w-[420px] rounded-3xl border border-white/20 bg-slate-900/90 p-6 text-center shadow-2xl sm:p-7">
            <div
              className={`mb-2 text-xs font-extrabold tracking-widest ${
                gameOverInfo.isNewRecord && gameOverInfo.finalScore > 0
                  ? 'text-amber-300'
                  : 'text-rose-400'
              }`}
            >
              {gameOverInfo.isNewRecord && gameOverInfo.finalScore > 0
                ? '突破歷史最高紀錄'
                : '碰撞障礙物'}
            </div>

            <h2 className="mb-2 text-3xl font-black tracking-tight text-white">遊戲結束</h2>
            <p className="mb-5 text-sm leading-relaxed text-slate-300">
              {gameOverInfo.isNewRecord && gameOverInfo.finalScore > 0
                ? '太強了！你刷新了歷史最高分數紀錄！'
                : '方塊恐龍撞上障礙物碎裂了，再試一次突破紀錄吧！'}
            </p>

            <div className="mb-6 grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-white/15 bg-white/5 px-3 py-3.5">
                <div className="mb-1 text-[11px] font-semibold tracking-wider text-slate-300">
                  本次分數
                </div>
                <div className="font-mono-num text-3xl font-black text-white">
                  {gameOverInfo.finalScore}
                </div>
              </div>
              <div className="rounded-2xl border border-white/15 bg-white/5 px-3 py-3.5">
                <div className="mb-1 text-[11px] font-semibold tracking-wider text-slate-300">
                  歷史最高
                </div>
                <div className="font-mono-num text-3xl font-black text-amber-400">
                  {gameOverInfo.highScore}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={handleStart}
              className="w-full cursor-pointer rounded-2xl bg-gradient-to-br from-emerald-400 to-green-500 px-6 py-3.5 text-lg font-extrabold tracking-wide text-emerald-950 shadow-lg shadow-emerald-500/35 transition-transform duration-150 hover:-translate-y-0.5 hover:shadow-emerald-500/50 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none active:scale-[0.98]"
            >
              重新開始
            </button>
          </div>
        </div>
      )}

      {/* Subtle Touch Hint (fades out once playing begins) */}
      <div
        className={`pointer-events-none fixed bottom-[max(14px,env(safe-area-inset-bottom))] left-1/2 z-10 -translate-x-1/2 rounded-xl bg-white/65 px-3.5 py-1.5 text-xs font-semibold whitespace-nowrap text-slate-900/75 shadow-sm transition-opacity duration-300 ${
          hasStartedOnce ? 'opacity-0' : 'opacity-100'
        }`}
      >
        滑動螢幕或使用方向鍵控制跑道與跳躍
      </div>
    </div>
  );
}
