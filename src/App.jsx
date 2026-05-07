import React, {
  useEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
} from 'react';

const clamp = (n, min, max) =>
  Math.max(min, Math.min(max, n));

const SPORTSBOOKS = [
  'DraftKings',
  'FanDuel',
  'BetMGM',
  'Pinnacle',
];

const ODDS_API_KEY =
  import.meta.env.VITE_ODDS_API_KEY;

const WEATHER_API_KEY =
  import.meta.env.VITE_WEATHER_API_KEY;

const ODDS_API_URL =
  'https://api.the-odds-api.com/v4/sports/baseball_mlb/odds';

const TEAM_COORDINATES = {
  'New York Yankees': {
    lat: 40.8296,
    lon: -73.9262,
  },

  'Boston Red Sox': {
    lat: 42.3467,
    lon: -71.0972,
  },

  'Los Angeles Dodgers': {
    lat: 34.0739,
    lon: -118.24,
  },
};

const getLogoUrl = (teamId) =>
  `https://www.mlbstatic.com/team-logos/${teamId}.svg`;

const seededRandom = (seed) => {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
};

const americanToImplied = (odds) => {
  if (odds > 0) {
    return 100 / (odds + 100);
  }

  return (
    Math.abs(odds) /
    (Math.abs(odds) + 100)
  );
};

const generateBookOdds = (wp, seed) => {
  const variance =
    seededRandom(seed) * 18 - 9;

  const baseOdds =
    wp >= 50
      ? -Math.round(
          100 + (wp - 50) * 5
        )
      : Math.round(
          100 + (50 - wp) * 4
        );

  return Math.round(baseOdds + variance);
};

function poisson(lambda, rand) {
  const L = Math.exp(-lambda);

  let k = 0;
  let p = 1;

  do {
    k++;
    p *= rand();
  } while (p > L);

  return k - 1;
}

function simulateGame(
  homeLambda,
  awayLambda,
  sims = 3000,
  seed = 1
) {
  let wins = 0;

  for (let i = 0; i < sims; i++) {
    const randA = () =>
      seededRandom(seed + i * 2);

    const randB = () =>
      seededRandom(seed + i * 2 + 1);

    const homeRuns = poisson(
      homeLambda,
      randA
    );

    const awayRuns = poisson(
      awayLambda,
      randB
    );

    if (homeRuns > awayRuns) wins++;
    else if (homeRuns === awayRuns)
      wins += 0.5;
  }

  return (wins / sims) * 100;
}

const confidenceGrade = (
  wp,
  edge
) => {
  if (wp >= 67 && edge >= 12)
    return 'A+';

  if (wp >= 62 && edge >= 10)
    return 'A';

  if (wp >= 57 && edge >= 7)
    return 'B+';

  if (wp >= 53 && edge >= 5)
    return 'B';

  return 'C';
};

const impliedBetType = (
  wp,
  totalRuns,
  edge,
  volatility,
  ev
) => {
  if (
    ev < -2 ||
    (edge < 2 && volatility > 11)
  ) {
    return 'PASS';
  }

  if (wp >= 63 && edge >= 8) {
    return 'ML';
  }

  if (
    wp >= 57 &&
    edge >= 5 &&
    volatility <= 9
  ) {
    return 'RL';
  }

  if (totalRuns >= 9.2) {
    return 'OVER';
  }

  if (totalRuns <= 7.6) {
    return 'UNDER';
  }

  if (ev > 0) {
    return 'ML';
  }

  return 'PASS';
};

function StatCard({
  label,
  value,
  color,
}) {
  return (
    <div className="bg-slate-800 rounded-2xl p-4">
      <div className="text-xs text-slate-400 mb-1">
        {label}
      </div>

      <div
        className={`text-2xl font-bold ${color}`}
      >
        {value}
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-slate-400">
        {label}
      </span>

      <span>{value}</span>
    </div>
  );
}

function InfoCard({
  title,
  items,
}) {
  return (
    <div className="bg-slate-800 rounded-2xl p-5">
      <h3 className="font-semibold mb-4">
        {title}
      </h3>

      <div className="space-y-3 text-sm">
        {items.map(([k, v]) => (
          <Row
            key={k}
            label={k}
            value={v}
          />
        ))}
      </div>
    </div>
  );
}

function TeamCard({
  team,
  logo,
  pitcher,
  side,
}) {
  return (
    <div className="bg-slate-800 rounded-2xl p-5">
      <div className="flex items-center gap-3 mb-4">
        <img
          src={logo}
          alt={team}
          className="w-10 h-10"
        />

        <div>
          <div className="font-semibold text-lg">
            {team}
          </div>

          <div className="text-xs text-slate-400">
            {side} Team
          </div>
        </div>
      </div>

      <div className="space-y-3 text-sm">
        <Row
          label="Starter"
          value={pitcher.name}
        />

        <Row
          label="ERA"
          value={pitcher.era}
        />

        <Row
          label="WHIP"
          value={pitcher.whip}
        />

        <Row
          label="K/9"
          value={pitcher.k9}
        />
      </div>
    </div>
  );
}

export default function App() {
  const [games, setGames] =
    useState([]);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState('');

  const [
    expandedGame,
    setExpandedGame,
  ] = useState(null);

  const [
    selectedBook,
    setSelectedBook,
  ] = useState('DraftKings');

  const [
    analyticsMode,
    setAnalyticsMode,
  ] = useState('Sharp');

  const [
    lastUpdated,
    setLastUpdated,
  ] = useState('');

  const pitcherCache = useRef(
    new Map()
  );

  const weatherCache = useRef(
    new Map()
  );

  const today = useMemo(() => {
    return new Date().toLocaleDateString(
      'en-CA',
      {
        timeZone:
          'America/New_York',
      }
    );
  }, []);

  const formatOdds = (odds) =>
    odds > 0
      ? `+${odds}`
      : `${odds}`;

  const fetchRealOdds =
    async () => {
      try {
        if (!ODDS_API_KEY) {
          return [];
        }

        const res = await fetch(
          `${ODDS_API_URL}?apiKey=${ODDS_API_KEY}&regions=us&markets=h2h&oddsFormat=american`
        );

        if (!res.ok) {
          return [];
        }

        return await res.json();
      } catch {
        return [];
      }
    };

  const fetchWeatherData =
    async (teamName) => {
      try {
        const coords =
          TEAM_COORDINATES[
            teamName
          ];

        if (
          !coords ||
          !WEATHER_API_KEY
        ) {
          return {
            windBoost: 0,
            temperature: 72,
            windSpeed: 7,
          };
        }

        const cacheKey = `${coords.lat}-${coords.lon}`;

        if (
          weatherCache.current.has(
            cacheKey
          )
        ) {
          return weatherCache.current.get(
            cacheKey
          );
        }

        const res = await fetch(
          `https://api.openweathermap.org/data/2.5/weather?lat=${coords.lat}&lon=${coords.lon}&appid=${WEATHER_API_KEY}&units=imperial`
        );

        const data =
          await res.json();

        const result = {
          windBoost: clamp(
            (data.wind.speed - 5) /
              40,
            -0.15,
            0.35
          ),

          temperature:
            Math.round(
              data.main.temp
            ),

          windSpeed:
            Math.round(
              data.wind.speed
            ),
        };

        weatherCache.current.set(
          cacheKey,
          result
        );

        return result;
      } catch {
        return {
          windBoost: 0,
          temperature: 72,
          windSpeed: 7,
        };
      }
    };

  const fetchPitcherProfile =
    async (
      pitcherId,
      pitcherName
    ) => {
      try {
        if (
          pitcherCache.current.has(
            pitcherId
          )
        ) {
          return pitcherCache.current.get(
            pitcherId
          );
        }

        const res = await fetch(
          `https://statsapi.mlb.com/api/v1/people/${pitcherId}/stats?stats=season&group=pitching`
        );

        const data =
          await res.json();

        const stat =
          data?.stats?.[0]
            ?.splits?.[0]?.stat ||
          {};

        const profile = {
          name:
            pitcherName || 'TBD',

          era: Number(
            parseFloat(
              stat.era || 4.2
            ).toFixed(2)
          ),

          whip: Number(
            parseFloat(
              stat.whip || 1.3
            ).toFixed(2)
          ),

          k9: Number(
            parseFloat(
              stat.strikeoutsPer9Inn ||
                8.1
            ).toFixed(1)
          ),
        };

        pitcherCache.current.set(
          pitcherId,
          profile
        );

        return profile;
      } catch {
        return {
          name:
            pitcherName || 'TBD',
          era: 4.2,
          whip: 1.3,
          k9: 8.1,
        };
      }
    };

  const loadGames = useCallback(
    async (signal) => {
      setLoading(true);
      setError('');

      try {
        const realOdds =
          await fetchRealOdds();

        const res = await fetch(
          `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${today}&hydrate=team,linescore,probablePitcher`,
          signal
            ? { signal }
            : {}
        );

        const data =
          await res.json();

        const slate =
          await Promise.all(
            (data?.dates || [])
              .flatMap(
                (d) =>
                  d.games || []
              )
              .map(async (g) => {
                const away =
                  g?.teams?.away
                    ?.team?.name;

                const home =
                  g?.teams?.home
                    ?.team?.name;

                const awayId =
                  g?.teams?.away
                    ?.team?.id;

                const homeId =
                  g?.teams?.home
                    ?.team?.id;

                const awayPitcher =
                  await fetchPitcherProfile(
                    g?.teams?.away
                      ?.probablePitcher
                      ?.id,

                    g?.teams?.away
                      ?.probablePitcher
                      ?.fullName
                  );

                const homePitcher =
                  await fetchPitcherProfile(
                    g?.teams?.home
                      ?.probablePitcher
                      ?.id,

                    g?.teams?.home
                      ?.probablePitcher
                      ?.fullName
                  );

                const weather =
                  await fetchWeatherData(
                    home
                  );

                const homeLambda =
                  clamp(
                    4.35 +
                      (5 -
                        awayPitcher.era) *
                        0.4,
                    2.5,
                    7
                  );

                const awayLambda =
                  clamp(
                    4.35 +
                      (5 -
                        homePitcher.era) *
                        0.4,
                    2.5,
                    7
                  );

                const wp =
                  Math.round(
                    clamp(
                      simulateGame(
                        homeLambda,
                        awayLambda,
                        3000,
                        g.gamePk
                      ),
                      35,
                      75
                    )
                  );

                const edge =
                  Math.abs(wp - 50);

                const volatility =
                  Number(
                    (
                      Math.abs(
                        homeLambda -
                          awayLambda
                      ) * 8
                    ).toFixed(1)
                  );

                const sportsbookOdds =
                  {
                    DraftKings:
                      generateBookOdds(
                        wp,
                        g.gamePk +
                          11
                      ),

                    FanDuel:
                      generateBookOdds(
                        wp,
                        g.gamePk +
                          22
                      ),

                    BetMGM:
                      generateBookOdds(
                        wp,
                        g.gamePk +
                          33
                      ),

                    Pinnacle:
                      generateBookOdds(
                        wp,
                        g.gamePk +
                          44
                      ),
                  };

                const matchedOdds =
                  realOdds.find(
                    (o) =>
                      o.home_team?.toLowerCase() ===
                        home?.toLowerCase() &&
                      o.away_team?.toLowerCase() ===
                        away?.toLowerCase()
                  );

                if (
                  matchedOdds?.bookmakers
                    ?.length
                ) {
                  matchedOdds.bookmakers.forEach(
                    (
                      book
                    ) => {
                      const market =
                        book.markets?.find(
                          (
                            m
                          ) =>
                            m.key ===
                            'h2h'
                        );

                      const outcome =
                        market?.outcomes?.find(
                          (
                            o
                          ) =>
                            o.name?.toLowerCase() ===
                            home?.toLowerCase()
                        );

                      if (
                        outcome
                      ) {
                        sportsbookOdds[
                          book.title
                        ] =
                          outcome.price;
                      }
                    }
                  );
                }

                const marketOdds =
                  sportsbookOdds[
                    selectedBook
                  ];

                const impliedProb =
                  americanToImplied(
                    marketOdds
                  ) * 100;

                const ev =
                  Number(
                    (
                      wp -
                      impliedProb
                    ).toFixed(1)
                  );

                const totalRuns =
                  Number(
                    (
                      homeLambda +
                      awayLambda +
                      weather.windBoost
                    ).toFixed(1)
                  );

                return {
                  id: g.gamePk,

                  away,
                  home,

                  awayLogo:
                    getLogoUrl(
                      awayId
                    ),

                  homeLogo:
                    getLogoUrl(
                      homeId
                    ),

                  awayPitcher,
                  homePitcher,

                  wp,

                  edge,

                  ev,

                  totalRuns,

                  volatility,

                  sportsbookOdds,

                  marketOdds,

                  weather,

                  bet: impliedBetType(
                    wp,
                    totalRuns,
                    edge,
                    volatility,
                    ev
                  ),

                  status:
                    g?.status
                      ?.detailedState,

                  awayScore:
                    g?.teams?.away
                      ?.score || 0,

                  homeScore:
                    g?.teams?.home
                      ?.score || 0,

                  grade:
                    confidenceGrade(
                      wp,
                      edge
                    ),
                };
              })
          );

        setGames(slate);

        setLastUpdated(
          new Date().toLocaleTimeString()
        );

        if (
          slate.length &&
          !expandedGame
        ) {
          setExpandedGame(
            slate[0].id
          );
        }
      } catch {
        setError(
          'Failed to load MLB data'
        );
      } finally {
        setLoading(false);
      }
    },
    [today, selectedBook]
  );

  useEffect(() => {
    const controller =
      new AbortController();

    loadGames(controller.signal);

    return () =>
      controller.abort();
  }, [loadGames]);

  const selectedGame =
    games.find(
      (g) =>
        g.id === expandedGame
    );

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
          <div>
            <h1 className="text-4xl font-bold">
              MLB Sharp Board Elite Lite
            </h1>

            <p className="text-slate-400 mt-1">
              Fully connected MLB intelligence engine
            </p>
          </div>

          <div className="flex gap-3 flex-wrap">
            <select
              value={selectedBook}
              onChange={(e) =>
                setSelectedBook(
                  e.target.value
                )
              }
              className="bg-slate-800 rounded-xl px-4 py-2"
            >
              {SPORTSBOOKS.map(
                (book) => (
                  <option key={book}>
                    {book}
                  </option>
                )
              )}
            </select>

            <select
              value={analyticsMode}
              onChange={(e) =>
                setAnalyticsMode(
                  e.target.value
                )
              }
              className="bg-slate-800 rounded-xl px-4 py-2"
            >
              <option>
                Sharp
              </option>

              <option>
                Aggressive
              </option>

              <option>
                Conservative
              </option>
            </select>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 mb-6">
          {games.map((game) => (
            <button
              key={game.id}
              onClick={() =>
                setExpandedGame(
                  game.id
                )
              }
              className={`flex items-center gap-2 px-4 py-3 rounded-xl ${
                expandedGame ===
                game.id
                  ? 'bg-blue-600'
                  : 'bg-slate-800'
              }`}
            >
              <img
                src={
                  game.awayLogo
                }
                alt={game.away}
                className="w-6 h-6"
              />

              <span className="text-slate-400 text-xs">
                VS
              </span>

              <img
                src={
                  game.homeLogo
                }
                alt={game.home}
                className="w-6 h-6"
              />
            </button>
          ))}
        </div>

        {loading && (
          <div className="bg-slate-900 rounded-2xl p-10 text-center">
            Loading MLB slate...
          </div>
        )}

        {error && (
          <div className="bg-red-900/30 border border-red-700 rounded-2xl p-4">
            {error}
          </div>
        )}

        {!loading &&
          selectedGame && (
            <div className="bg-slate-900 rounded-3xl p-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                <StatCard
                  label="Win Probability"
                  value={`${selectedGame.wp}%`}
                  color="text-emerald-300"
                />

                <StatCard
                  label="Recommended Bet"
                  value={
                    selectedGame.bet
                  }
                  color="text-sky-300"
                />

                <StatCard
                  label="Edge"
                  value={`${selectedGame.edge}%`}
                  color="text-amber-300"
                />

                <StatCard
                  label="EV"
                  value={`${selectedGame.ev}%`}
                  color="text-rose-300"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                <TeamCard
                  team={
                    selectedGame.away
                  }
                  logo={
                    selectedGame.awayLogo
                  }
                  pitcher={
                    selectedGame.awayPitcher
                  }
                  side="Away"
                />

                <TeamCard
                  team={
                    selectedGame.home
                  }
                  logo={
                    selectedGame.homeLogo
                  }
                  pitcher={
                    selectedGame.homePitcher
                  }
                  side="Home"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <InfoCard
                  title="Market Intelligence"
                  items={[
                    [
                      'Odds',
                      formatOdds(
                        selectedGame.marketOdds
                      ),
                    ],

                    [
                      'DraftKings',
                      formatOdds(
                        selectedGame
                          .sportsbookOdds
                          .DraftKings
                      ),
                    ],

                    [
                      'FanDuel',
                      formatOdds(
                        selectedGame
                          .sportsbookOdds
                          .FanDuel
                      ),
                    ],

                    [
                      'BetMGM',
                      formatOdds(
                        selectedGame
                          .sportsbookOdds
                          .BetMGM
                      ),
                    ],

                    [
                      'Pinnacle',
                      formatOdds(
                        selectedGame
                          .sportsbookOdds
                          .Pinnacle
                      ),
                    ],
                  ]}
                />

                <InfoCard
                  title="Game Environment"
                  items={[
                    [
                      'Projected Total',
                      selectedGame.totalRuns,
                    ],

                    [
                      'Temperature',
                      `${selectedGame.weather.temperature}°`,
                    ],

                    [
                      'Wind',
                      `${selectedGame.weather.windSpeed} MPH`,
                    ],

                    [
                      'Volatility',
                      selectedGame.volatility,
                    ],
                  ]}
                />

                <InfoCard
                  title={`${analyticsMode} Analytics`}
                  items={[
                    [
                      'Grade',
                      selectedGame.grade,
                    ],

                    [
                      'Sharp Signal',
                      selectedGame.ev >= 5
                        ? '🔥 YES'
                        : 'No',
                    ],

                    [
                      'Updated',
                      lastUpdated,
                    ],
                  ]}
                />
              </div>
            </div>
          )}
      </div>
    </div>
  );
}
