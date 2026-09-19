import React, { useState, useRef } from 'react';
import { Gamepad2, Tv, Users, Disc3, X } from 'lucide-react';
import { StationLive } from '../types';

export interface GameItem {
  id: string;
  title: string;
  platform: 'PS5' | 'PS4';
  coverUrl: string;
  rating: 'E' | 'T' | 'M';
  publisher: string;
  genre: string;
  resolution: string;
  players: string;
  features: string[];
  description: string;
  defaultSpotlight?: boolean;
}

export const CATALOGUE_GAMES: GameItem[] = [
  {
    id: 'spiderman',
    title: "Marvel's Spider-Man 2",
    platform: 'PS5',
    coverUrl: '/games/spiderman.jpg',
    rating: 'T',
    publisher: 'PlayStation Studios',
    genre: 'Action / Adventure',
    resolution: '4K 60-120FPS HDR',
    players: '1 Player',
    features: ['Ray Tracing', 'DualSense Haptics', 'Instant Fast Travel'],
    description: 'Peter Parker and Miles Morales return in an exciting new adventure in the critically acclaimed Marvel Spider-Man franchise.',
  },
  {
    id: 'tekken8',
    title: 'Tekken 8',
    platform: 'PS5',
    coverUrl: '/games/tekken8.jpg',
    rating: 'T',
    publisher: 'Bandai Namco',
    genre: 'Fighting / Competitive',
    resolution: '4K 60FPS Low-Latency',
    players: '1-2 Players Local',
    features: ['Unreal Engine 5', 'Heat System', 'Arcade Controls'],
    description: 'Fist Meets Fate in TEKKEN 8. Powered by Unreal Engine 5, featuring intense new battle mechanics and next-gen visual destruction.',
    defaultSpotlight: true,
  },
  {
    id: 'mortalkombat',
    title: 'Mortal Kombat 1',
    platform: 'PS5',
    coverUrl: '/games/mortalkombat.jpg',
    rating: 'M',
    publisher: 'Warner Bros. Games',
    genre: 'Fighting / Action',
    resolution: '4K Ultra HD',
    players: '1-2 Players Local',
    features: ['Kameo Fighters', 'Cinematic Story', 'Fatalities'],
    description: 'Discover a reborn Mortal Kombat Universe created by the Fire God Liu Kang with a new fighting system and game modes.',
  },
  {
    id: 'horizon',
    title: 'Horizon Forbidden West',
    platform: 'PS5',
    coverUrl: '/games/horizon.jpg',
    rating: 'T',
    publisher: 'PlayStation Studios',
    genre: 'Open World RPG',
    resolution: '4K Dynamic HDR',
    players: '1 Player',
    features: ['Dynamic Weather', '3D Audio', 'Adaptive Triggers'],
    description: 'Explore distant lands, fight bigger and more awe-inspiring machines, and encounter astonishing new tribes.',
  },
  {
    id: 'gta5',
    title: 'Grand Theft Auto V',
    platform: 'PS5',
    coverUrl: '/games/gta5.jpg',
    rating: 'M',
    publisher: 'Rockstar Games',
    genre: 'Open World / Crime',
    resolution: '4K 60FPS Fidelity',
    players: '1 Player / GTA Online',
    features: ['Ray-Traced Reflections', 'DualSense Support', 'Fast Loading'],
    description: 'Experience entertainment blockbusters Grand Theft Auto V and GTA Online with stunning new visuals and high-performance modes.',
  },
  {
    id: 'godofwar',
    title: 'God of War Ragnarök',
    platform: 'PS5',
    coverUrl: '/games/godofwar.jpg',
    rating: 'M',
    publisher: 'PlayStation Studios',
    genre: 'Action / Mythic',
    resolution: '4K 120Hz Target',
    players: '1 Player',
    features: ['Leviathan Axe', 'Nine Realms', 'DualSense Feel'],
    description: 'Embark on an epic and heartfelt journey as Kratos and Atreus struggle with holding on and letting go.',
  },
  {
    id: 'fc24',
    title: 'EA Sports FC 24',
    platform: 'PS5',
    coverUrl: '/games/fc24.jpg',
    rating: 'E',
    publisher: 'EA Sports',
    genre: 'Sports Simulation',
    resolution: '4K 60FPS Fluid',
    players: '1-4 Players Local',
    features: ['HyperMotionV', 'PlayStyles', 'Frostbite Engine'],
    description: 'The World’s Game. Experience unparalleled realism with HyperMotionV, PlayStyles optimized by Opta, and revolutionized Frostbite.',
  },
  {
    id: 'granturismo7',
    title: 'Gran Turismo 7',
    platform: 'PS5',
    coverUrl: '/games/granturismo7.jpg',
    rating: 'E',
    publisher: 'Polyphony Digital',
    genre: 'Racing Simulation',
    resolution: '4K 120FPS HDR',
    players: '1-2 Players Split / Online',
    features: ['True Force Feedback', 'Ray Traced Scapes', 'Dynamic Physics'],
    description: 'The Real Driving Simulator. Over 400 cars and 90 track routes in dynamic weather conditions with ultra-realistic physics.',
  },
];

interface GameCatalogueCarouselProps {
  userName?: string;
  stations?: StationLive[];
  onBookStation?: (station: StationLive) => void;
}

export const GameCatalogueCarousel: React.FC<GameCatalogueCarouselProps> = ({
  userName = 'gopi',
  stations = [],
  onBookStation,
}) => {
  const [isPaused, setIsPaused] = useState(false);
  const [selectedGame, setSelectedGame] = useState<GameItem | null>(null);
  const [spotlightId, setSpotlightId] = useState<string>('tekken8');
  const reelRef = useRef<HTMLDivElement>(null);

  // Duplicate items for seamless continuous looping reel
  const loopGames = [...CATALOGUE_GAMES, ...CATALOGUE_GAMES, ...CATALOGUE_GAMES];

  // Find stations that match or are PS5 consoles
  const ps5Stations = stations.filter(
    (s) => s.tier === 'CONSOLE' || s.name.toUpperCase().includes('PS')
  );

  return (
    <div className="relative w-full overflow-hidden text-white py-2 sm:py-4">
      {/* Ambient background glows & star dust particles blending into lounge */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/4 left-1/4 w-[500px] h-[350px] bg-blue-600/10 rounded-full blur-[100px]" />
        <div className="absolute -bottom-10 right-1/4 w-[500px] h-[350px] bg-cyan-500/10 rounded-full blur-[100px]" />
        {/* Floating Particles */}
        <div className="absolute top-6 left-12 text-blue-400/40 text-xs animate-pulse">✦</div>
        <div className="absolute top-16 right-20 text-cyan-300/50 text-sm animate-pulse delay-700">✦</div>
        <div className="absolute bottom-10 left-1/4 text-indigo-400/30 text-xs animate-pulse delay-300">✦</div>
        <div className="absolute top-1/2 right-1/3 text-blue-300/40 text-base animate-pulse delay-500">✦</div>
      </div>

      {/* Main Container: Seamlessly blended layout without box borders */}
      <div className="relative z-10 flex flex-col lg:flex-row items-center min-h-[300px] gap-6 lg:gap-8">
        {/* LEFT PANEL: Welcome text without box borders or divider lines */}
        <div className="w-full lg:w-[38%] px-2 sm:px-4 lg:px-6 py-2 flex flex-col justify-center space-y-3 shrink-0">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/15 border border-blue-400/30 text-blue-300 text-xs font-semibold tracking-wide w-fit">
            <Disc3 className="w-3.5 h-3.5 text-cyan-400 animate-spin" style={{ animationDuration: '6s' }} />
            <span>PS5 Ultra 4K Game Vault</span>
          </div>

          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-black font-display tracking-tight text-white leading-tight">
            Welcome to the Lounge, <span className="text-cyan-400 uppercase">{userName}!</span>
          </h2>

          <p className="text-xs sm:text-sm text-slate-300 leading-relaxed max-w-lg">
            High-performance 4K PS5 gaming meets elevated comfort food. Savor gourmet snacks, craft coffee, and chilled refreshments brought directly to your setup.
          </p>
        </div>

        {/* RIGHT PANEL: Right-to-Left Continuous Sliding Reel with soft blending fades */}
        <div
          className="w-full lg:w-[62%] relative overflow-hidden flex items-center py-2 px-1"
          onMouseEnter={() => setIsPaused(true)}
          onMouseLeave={() => setIsPaused(false)}
          onTouchStart={() => setIsPaused(true)}
          onTouchEnd={() => setIsPaused(false)}
        >
          {/* Edge gradient fades blending into background */}
          <div className="absolute left-0 top-0 bottom-0 w-8 sm:w-16 md:w-20 bg-gradient-to-r from-[#070b14] via-[#070b14]/80 to-transparent z-20 pointer-events-none" />
          <div className="absolute right-0 top-0 bottom-0 w-8 sm:w-16 md:w-20 bg-gradient-to-l from-[#070b14] via-[#070b14]/80 to-transparent z-20 pointer-events-none" />

          {/* Marquee sliding track with Touch-Swipe & Scroll-Snap alongside 60fps GPU animation */}
          <div
            ref={reelRef}
            className={`flex items-end gap-3 sm:gap-4 md:gap-6 overflow-x-auto no-scrollbar carousel-touch-snap py-4 px-3 sm:px-4 ${
              isPaused ? 'reel-paused' : 'animate-reel-left'
            }`}
            style={{
              ['--reel-duration' as any]: '32s',
            }}
          >

            {loopGames.map((game, index) => {
              const isSpotlight = spotlightId === game.id;

              return (
                <div
                  key={`${game.id}-${index}`}
                  className="ps-case-container shrink-0 cursor-pointer select-none group carousel-snap-item"
                  onClick={() => {
                    setSpotlightId(game.id);
                    setSelectedGame(game);
                  }}
                >
                  {/* The 3D Game Case (scaled so >=2.5 cards fit on mobile) */}
                  <div
                    className={`ps-game-case w-[100px] xs:w-[110px] sm:w-[130px] md:w-[145px] lg:w-[160px] h-[155px] xs:h-[170px] sm:h-[200px] md:h-[220px] lg:h-[245px] rounded-lg sm:rounded-xl overflow-hidden border-2 transition-all duration-300 flex flex-col bg-slate-900 relative shadow-2xl ${
                      isSpotlight
                        ? 'ps-case-spotlight scale-105 border-cyan-400 z-10'
                        : 'border-slate-700/70 hover:border-cyan-400/80 group-hover:scale-105'
                    }`}
                  >
                    {/* Top PlayStation Header Bar (Crisp PS5/PS4 banner) */}
                    <div
                      className={`h-5 sm:h-7 lg:h-8 px-1.5 sm:px-2.5 flex items-center justify-between shrink-0 ${
                        game.platform === 'PS5'
                          ? 'bg-slate-100 text-slate-950'
                          : 'bg-[#003791] text-white'
                      }`}
                    >
                      {/* PlayStation Official Vector Logo */}
                      <svg className="w-3.5 sm:w-5 h-3 sm:h-4 fill-current" viewBox="0 0 32 24">
                        <path d="M12.02 0c-4.42 0-8 3.58-8 8 0 2.22.9 4.22 2.36 5.67l.1.1.28.27.02.02c1.37 1.25 3.2 2.01 5.24 2.01s3.87-.76 5.24-2.01l.02-.02.28-.27.1-.1c1.46-1.45 2.36-3.45 2.36-5.67 0-4.42-3.58-8-8-8zm-5.1 7.82c0-2.82 2.28-5.1 5.1-5.1s5.1 2.28 5.1 5.1c0 1.25-.45 2.39-1.2 3.28l-.07.07c-1 .97-2.36 1.57-3.83 1.57s-2.83-.6-3.83-1.57l-.07-.07c-.75-.89-1.2-2.03-1.2-3.28zm21.36 10.36l-8.6-4.96c-.23-.13-.48-.2-.74-.2-.55 0-1 .45-1 1v1.12l8.36 4.83c.31.18.66.27 1.02.27.76 0 1.45-.43 1.78-1.09.43-.88.06-1.93-.82-2.37l-.0-.6zm-17.56 0c-.88.44-1.25 1.49-.82 2.37.33.66 1.02 1.09 1.78 1.09.36 0 .71-.09 1.02-.27l8.36-4.83v-1.12c0-.55-.45-1-1-1-.26 0-.51.07-.74.2l-8.6 4.96v.6z" />
                      </svg>
                      <span className="font-extrabold text-[10px] sm:text-xs lg:text-sm tracking-wider font-mono">
                        {game.platform}
                      </span>
                    </div>

                    {/* Game Cover Art Image */}
                    <div className="relative flex-1 w-full bg-slate-950 overflow-hidden">
                      <img
                        src={game.coverUrl}
                        alt={game.title}
                        className="w-full h-full object-cover object-center group-hover:scale-105 transition-transform duration-500"
                        loading="lazy"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />

                      {/* Gloss / Light reflection diagonal sheen over plastic sleeve */}
                      <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/10 to-transparent pointer-events-none" />

                      {/* Bottom Case Details: ESRB Rating Badge & Publisher */}
                      <div className="absolute bottom-1 left-1 right-1 flex items-center justify-between pointer-events-none">
                        <span className="text-[8px] sm:text-[9px] font-bold px-1 py-0.2 rounded bg-black/80 text-white border border-white/20">
                          {game.rating}
                        </span>
                        <span className="text-[8px] sm:text-[9px] font-semibold px-1 py-0.2 rounded bg-black/70 text-slate-300 truncate max-w-[70px] sm:max-w-[85px]">
                          {game.publisher}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Floor Reflection Mirror */}
                  <div className="w-[100px] xs:w-[110px] sm:w-[130px] md:w-[145px] lg:w-[160px] h-8 sm:h-10 lg:h-12 overflow-hidden opacity-35 transform scale-y-[-1] pointer-events-none filter blur-[1px] mt-1 [mask-image:linear-gradient(to_bottom,rgba(0,0,0,0.8)_0%,transparent_90%)]">
                    <img
                      src={game.coverUrl}
                      alt=""
                      className="w-full h-full object-cover object-top"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* QUICK GAME DETAIL MODAL / DRAWER */}
      {selectedGame && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in">
          <div className="relative w-full max-w-xl rounded-3xl bg-slate-900 border border-cyan-500/40 p-6 sm:p-8 shadow-[0_0_60px_rgba(6,182,212,0.3)] text-white">
            {/* Close button */}
            <button
              onClick={() => setSelectedGame(null)}
              className="absolute top-5 right-5 p-2 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex flex-col sm:flex-row gap-6 items-start">
              {/* Cover Preview with 3D Border */}
              <div className="w-36 h-52 shrink-0 rounded-xl overflow-hidden border-2 border-cyan-400 shadow-[0_0_30px_rgba(6,182,212,0.6)] bg-slate-950 flex flex-col">
                <div
                  className={`h-6 px-2 flex items-center justify-between shrink-0 ${
                    selectedGame.platform === 'PS5' ? 'bg-white text-black' : 'bg-blue-700 text-white'
                  }`}
                >
                  <span className="text-[10px] font-bold">PlayStation</span>
                  <span className="text-[11px] font-black">{selectedGame.platform}</span>
                </div>
                <img
                  src={selectedGame.coverUrl}
                  alt={selectedGame.title}
                  className="w-full flex-1 object-cover"
                />
              </div>

              {/* Game Info Details */}
              <div className="flex-1 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 uppercase">
                    {selectedGame.genre}
                  </span>
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                    ESRB {selectedGame.rating}
                  </span>
                </div>

                <h3 className="text-2xl font-black font-display text-white">
                  {selectedGame.title}
                </h3>

                <p className="text-xs text-slate-300 leading-relaxed">
                  {selectedGame.description}
                </p>

                {/* Specs Grid */}
                <div className="grid grid-cols-2 gap-2 pt-2 text-xs">
                  <div className="flex items-center gap-2 text-slate-300">
                    <Tv className="w-4 h-4 text-cyan-400 shrink-0" />
                    <span>{selectedGame.resolution}</span>
                  </div>
                  <div className="flex items-center gap-2 text-slate-300">
                    <Users className="w-4 h-4 text-cyan-400 shrink-0" />
                    <span>{selectedGame.players}</span>
                  </div>
                </div>

                {/* Feature Pills */}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {selectedGame.features.map((feat, i) => (
                    <span
                      key={i}
                      className="text-[10px] px-2 py-0.5 rounded-md bg-blue-950/60 text-blue-300 border border-blue-800/50"
                    >
                      {feat}
                    </span>
                  ))}
                </div>

                {/* Station Availability & Action */}
                <div className="pt-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 border-t border-slate-800">
                  <div className="text-xs text-slate-400">
                    <div className="text-[11px] text-slate-400 mb-1">Installed Stations:</div>
                    <div className="flex items-center gap-1.5">
                      {['PS1', 'PS2', 'PS3'].map((stn) => (
                        <span
                          key={stn}
                          className="px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-mono text-[11px] font-semibold"
                        >
                          {stn}
                        </span>
                      ))}
                    </div>
                  </div>

                  {onBookStation && ps5Stations.length > 0 && (
                    <button
                      onClick={() => {
                        const available = ps5Stations.find((s) => s.status === 'AVAILABLE') || ps5Stations[0];
                        onBookStation(available);
                        setSelectedGame(null);
                      }}
                      className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 font-bold text-xs shadow-[0_0_20px_rgba(6,182,212,0.4)] flex items-center justify-center gap-2 text-white transition-all transform active:scale-95 cursor-pointer"
                    >
                      <Gamepad2 className="w-4 h-4" />
                      <span>Book PS5 Session</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
