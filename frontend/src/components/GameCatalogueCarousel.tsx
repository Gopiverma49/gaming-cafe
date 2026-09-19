import React, { useState } from 'react';
import { Disc3, Sparkles } from 'lucide-react';

export interface GameItem {
  index: number;
  id: string;
  title: string;
}

export const CATALOGUE_GAMES: GameItem[] = [
  { index: 0, id: 'gta6', title: 'Grand Theft Auto VI' },
  { index: 1, id: 'spiderman2', title: "Marvel's Spider-Man 2" },
  { index: 2, id: 'tekken8', title: 'Tekken 8' },
  { index: 3, id: 'fc26', title: 'EA Sports FC 26' },
  { index: 4, id: 'cyberpunk', title: 'Cyberpunk 2077: Phantom Liberty' },
  { index: 5, id: 'mk1', title: 'Mortal Kombat 1' },
  { index: 6, id: 'ghost_of_tsushima', title: "Ghost of Tsushima: Director's Cut" },
  { index: 7, id: 'god_of_war', title: 'God of War Ragnarök' },
  { index: 8, id: 'gta5', title: 'Grand Theft Auto V' },
  { index: 9, id: 'f1_25', title: 'EA Sports F1 25' },
  { index: 10, id: 'last_of_us_2', title: 'The Last of Us Part II Remastered' },
  { index: 11, id: 'crew_motorfest', title: 'The Crew Motorfest' },
  { index: 12, id: 'spiderman_miles', title: "Marvel's Spider-Man: Miles Morales" },
  { index: 13, id: 'ac_mirage', title: "Assassin's Creed Mirage" },
  { index: 14, id: 'mk11', title: 'Mortal Kombat 11 Ultimate' },
  { index: 15, id: 'gt7', title: 'Gran Turismo 7' },
  { index: 16, id: 'battlefield6', title: 'Battlefield 6' },
  { index: 17, id: 'rdr', title: 'Red Dead Redemption' },
  { index: 18, id: 'wwe2k26', title: 'WWE 2K26' },
  { index: 19, id: 'spiderman_remaster', title: "Marvel's Spider-Man Remastered" },
  { index: 20, id: 'forza5', title: 'Forza Horizon 5 (PS5 Edition)' },
];

interface GameCatalogueCarouselProps {
  userName?: string;
}

export const GameCatalogueCarousel: React.FC<GameCatalogueCarouselProps> = ({
  userName = 'gopi',
}) => {
  const [isPaused, setIsPaused] = useState(false);

  return (
    <div className="relative w-full rounded-2xl sm:rounded-3xl bg-gradient-to-br from-slate-900/90 via-[#0a0f1d]/90 to-slate-950/95 border border-slate-800/80 p-4 sm:p-6 lg:p-7 shadow-2xl overflow-hidden backdrop-blur-xl">
      {/* Ambient background glow & atmospheric star sparks */}
      <div className="absolute top-0 left-1/4 w-96 h-64 bg-blue-600/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-96 h-64 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute top-4 right-10 text-cyan-400/40 text-xs animate-pulse pointer-events-none">✦</div>
      <div className="absolute bottom-6 left-12 text-blue-400/30 text-sm animate-pulse pointer-events-none delay-500">✦</div>

      {/* Layout & Positioning: Desktop side-by-side (45% left / 55% right); Mobile stacked (100% full width) */}
      <div className="relative z-10 flex flex-col lg:flex-row items-center gap-6 lg:gap-8">
        
        {/* LEFT PANEL (~45% on desktop, stacks on mobile) */}
        <div className="w-full lg:w-[45%] shrink-0 flex flex-col justify-center space-y-3">
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

          <div className="flex items-center gap-4 pt-1 text-xs text-slate-400">
            <span className="flex items-center gap-1.5 text-cyan-300 font-medium">
              <Sparkles className="w-3.5 h-3.5" /> 21 PS5 Titles Ready
            </span>
            <span className="text-slate-600">•</span>
            <span className="text-slate-400">Live in Lounge Now</span>
          </div>
        </div>

        {/* RIGHT PANEL (~55% on desktop, expands to 100% full width on mobile) */}
        <div className="w-full lg:w-[55%] relative overflow-hidden py-1">
          {/* Continuous Infinite Marquee with mask-image gradient fade */}
          <div
            className={`marquee-container marquee-mask relative w-full overflow-hidden select-none pointer-events-auto ${
              isPaused ? 'marquee-paused' : ''
            }`}
            onMouseEnter={() => setIsPaused(true)}
            onMouseLeave={() => setIsPaused(false)}
            onTouchStart={() => setIsPaused(true)}
            onTouchEnd={() => setIsPaused(false)}
          >
            <div className="flex w-max">
              {/* Group 1: 21 games */}
              <div
                className="flex shrink-0 items-center gap-3 sm:gap-4 pr-3 sm:pr-4 animate-marquee-infinite"
                style={{ ['--marquee-duration' as any]: '40s' }}
              >
                {CATALOGUE_GAMES.map((game) => (
                  <GameCard
                    key={`g1-${game.id}`}
                    game={game}
                  />
                ))}
              </div>

              {/* Group 2: Exact duplicate for seamless continuous infinite loop */}
              <div
                className="flex shrink-0 items-center gap-3 sm:gap-4 pr-3 sm:pr-4 animate-marquee-infinite"
                style={{ ['--marquee-duration' as any]: '40s' }}
                aria-hidden="true"
              >
                {CATALOGUE_GAMES.map((game) => (
                  <GameCard
                    key={`g2-${game.id}`}
                    game={game}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

interface GameCardProps {
  game: GameItem;
}

const GameCard: React.FC<GameCardProps> = ({ game }) => {
  return (
    <div
      title={game.title}
      aria-label={game.title}
      className="group shrink-0 select-none transition-transform duration-300 hover:-translate-y-1"
    >
      <div
        className="relative h-[130px] sm:h-[165px] aspect-[250/350] rounded-[8px] overflow-hidden border border-slate-700/80 bg-slate-900 transition-all duration-300 group-hover:border-cyan-400 group-hover:shadow-[0_0_22px_rgba(6,182,212,0.65),0_0_40px_rgba(59,130,246,0.35)]"
        style={{
          backgroundImage: "url('/games/games_sprite_strip.webp')",
          backgroundSize: '2100% 100%',
          backgroundPosition: `${(game.index / 20) * 100}% 0%`,
          backgroundRepeat: 'no-repeat',
        }}
      >
        {/* Gloss diagonal light sheen over the case sleeve */}
        <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/10 to-transparent pointer-events-none" />

        {/* Floor sheen overlay */}
        <div className="absolute inset-0 bg-cyan-400/0 group-hover:bg-cyan-400/10 transition-colors duration-300 pointer-events-none" />
      </div>
    </div>
  );
};
