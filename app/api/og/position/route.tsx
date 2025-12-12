import { ImageResponse } from '@vercel/og';
import { NextRequest } from 'next/server';

export const runtime = 'edge';

// m00n brand colors
const MOSS_GREEN = '#6ce5b1';
const DEEP_PURPLE = '#0a0612';
const ACCENT_PURPLE = '#8c54ff';

// Stars for 1200x800 canvas
const STAR_POSITIONS = [
  { x: 80, y: 50, s: 2 },
  { x: 200, y: 120, s: 1 },
  { x: 350, y: 40, s: 2 },
  { x: 500, y: 100, s: 1 },
  { x: 650, y: 60, s: 2 },
  { x: 800, y: 130, s: 1 },
  { x: 950, y: 45, s: 2 },
  { x: 1100, y: 110, s: 1 },
  { x: 120, y: 250, s: 1 },
  { x: 300, y: 320, s: 2 },
  { x: 550, y: 280, s: 1 },
  { x: 750, y: 350, s: 2 },
  { x: 1000, y: 290, s: 1 },
  { x: 180, y: 450, s: 2 },
  { x: 450, y: 500, s: 1 },
  { x: 700, y: 440, s: 2 },
  { x: 900, y: 520, s: 1 },
  { x: 1080, y: 460, s: 2 },
  { x: 100, y: 620, s: 1 },
  { x: 350, y: 680, s: 2 },
  { x: 600, y: 640, s: 1 },
  { x: 850, y: 700, s: 2 },
  { x: 1050, y: 650, s: 1 },
  { x: 250, y: 750, s: 2 },
  { x: 500, y: 770, s: 1 },
  { x: 780, y: 760, s: 2 },
  { x: 1000, y: 780, s: 1 }
];

// Format streak duration
function formatStreakDuration(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  // Position data from query params
  const tokenId = searchParams.get('tokenId') ?? '???';
  const bandType = searchParams.get('bandType') ?? 'custom';
  const rangeStatus = searchParams.get('rangeStatus') ?? 'unknown';
  const rangeLower = searchParams.get('rangeLower') ?? '0';
  const rangeUpper = searchParams.get('rangeUpper') ?? '0';
  const username = searchParams.get('username') ?? 'anon';
  const valueUsd = searchParams.get('valueUsd');
  const streakSeconds = searchParams.get('streak'); // Streak duration in seconds
  const points = searchParams.get('points'); // Points earned

  // Determine status
  const isInRange = rangeStatus === 'in-range';
  const statusColor = isInRange ? MOSS_GREEN : '#ff6b6b';

  // Streak display
  const hasStreak = streakSeconds && Number(streakSeconds) > 0;
  const streakDuration = hasStreak ? formatStreakDuration(Number(streakSeconds)) : null;
  const streakDays = hasStreak ? Number(streakSeconds) / 86400 : 0;

  // Streak tier for badge
  let streakTierColor = MOSS_GREEN;
  let streakTierEmoji = '🔥';
  if (streakDays >= 7) {
    streakTierColor = '#ffd700'; // Gold
    streakTierEmoji = '👑';
  } else if (streakDays >= 3) {
    streakTierColor = '#c0c0c0'; // Silver
    streakTierEmoji = '⭐';
  }

  // Format band type
  let bandEmoji = '⚖️';
  let bandLabel = 'DOUBLE SIDED';
  if (bandType === 'crash_band') {
    bandEmoji = '🔻';
    bandLabel = 'CRASH BAND';
  } else if (bandType === 'upside_band') {
    bandEmoji = '🚀';
    bandLabel = 'SKY BAND';
  } else if (bandType === 'double_sided') {
    bandEmoji = '⚖️';
    bandLabel = 'DOUBLE SIDED';
  }

  // Format numbers
  const lowerNum = Number(rangeLower) || 0;
  const upperNum = Number(rangeUpper) || 0;
  const rangeString = `$${lowerNum.toLocaleString()} → $${upperNum.toLocaleString()}`;

  // Position display
  const isNew = tokenId === 'new';

  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: DEEP_PURPLE,
          padding: '50px 80px',
          fontFamily: 'system-ui, sans-serif',
          position: 'relative',
          overflow: 'hidden',
          boxSizing: 'border-box'
        }}
      >
        {/* Starry background */}
        {STAR_POSITIONS.map((star, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: `${star.x}px`,
              top: `${star.y}px`,
              width: `${star.s}px`,
              height: `${star.s}px`,
              borderRadius: '50%',
              backgroundColor: 'white',
              opacity: 0.3 + (i % 4) * 0.15
            }}
          />
        ))}

        {/* Gradient glow */}
        <div
          style={{
            position: 'absolute',
            top: '-150px',
            right: '100px',
            width: '500px',
            height: '500px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(140, 84, 255, 0.15) 0%, transparent 70%)',
            display: 'flex'
          }}
        />

        {/* Top bar: Brand + Username */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '32px',
            position: 'relative',
            zIndex: 10,
            width: '100%'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <span style={{ fontSize: '52px' }}>🌙</span>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span
                style={{
                  fontSize: '32px',
                  fontWeight: 'bold',
                  color: 'white',
                  letterSpacing: '0.05em'
                }}
              >
                $m00n LP
              </span>
              <span
                style={{
                  fontSize: '14px',
                  color: 'rgba(255,255,255,0.5)',
                  letterSpacing: '0.1em',
                  marginTop: '2px'
                }}
              >
                CONCENTRATED LIQUIDITY
              </span>
            </div>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              backgroundColor: 'rgba(255,255,255,0.08)',
              padding: '10px 20px',
              borderRadius: '24px',
              border: '1px solid rgba(255,255,255,0.15)'
            }}
          >
            <span style={{ color: 'white', fontSize: '18px', fontWeight: 500 }}>@{username}</span>
          </div>
        </div>

        {/* Main content area */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            justifyContent: 'center',
            alignItems: 'center',
            position: 'relative',
            zIndex: 10
          }}
        >
          {/* Band type + Status row */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '16px',
              marginBottom: '28px',
              flexWrap: 'wrap'
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                backgroundColor: 'rgba(140, 84, 255, 0.15)',
                padding: '12px 24px',
                borderRadius: '16px',
                border: `1px solid ${ACCENT_PURPLE}50`
              }}
            >
              <span style={{ fontSize: '24px' }}>{bandEmoji}</span>
              <span
                style={{
                  fontSize: '18px',
                  fontWeight: 'bold',
                  color: ACCENT_PURPLE,
                  letterSpacing: '0.1em'
                }}
              >
                {bandLabel}
              </span>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                backgroundColor: `${statusColor}15`,
                padding: '12px 24px',
                borderRadius: '16px',
                border: `1px solid ${statusColor}50`
              }}
            >
              <span style={{ fontSize: '20px' }}>{isInRange ? '✅' : '⚠️'}</span>
              <span
                style={{
                  fontSize: '16px',
                  fontWeight: 'bold',
                  color: statusColor,
                  letterSpacing: '0.08em'
                }}
              >
                {isInRange ? 'IN RANGE' : 'OUT OF RANGE'}
              </span>
              {isInRange && (
                <span style={{ fontSize: '14px', color: MOSS_GREEN, marginLeft: '8px' }}>
                  💰 Earning
                </span>
              )}
            </div>

            {isNew && (
              <span
                style={{
                  fontSize: '16px',
                  color: 'rgba(255,255,255,0.6)',
                  fontWeight: 500
                }}
              >
                ✨ Just deployed
              </span>
            )}

            {/* Streak badge */}
            {hasStreak && streakDuration && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  backgroundColor: `${streakTierColor}15`,
                  padding: '12px 24px',
                  borderRadius: '16px',
                  border: `1px solid ${streakTierColor}50`
                }}
              >
                <span style={{ fontSize: '20px' }}>{streakTierEmoji}</span>
                <span
                  style={{
                    fontSize: '16px',
                    fontWeight: 'bold',
                    color: streakTierColor,
                    letterSpacing: '0.08em'
                  }}
                >
                  {streakDuration} STREAK
                </span>
              </div>
            )}
          </div>

          {/* Price range - big and bold */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              marginBottom: '20px'
            }}
          >
            <span
              style={{
                fontSize: '14px',
                color: 'rgba(255,255,255,0.4)',
                letterSpacing: '0.15em',
                marginBottom: '8px',
                textTransform: 'uppercase'
              }}
            >
              Market Cap Range
            </span>
            <span
              style={{
                fontSize: '48px',
                fontWeight: 'bold',
                color: 'white',
                fontFamily: 'monospace',
                letterSpacing: '-0.02em'
              }}
            >
              {rangeString}
            </span>
          </div>

          {/* Position value if available */}
          {valueUsd && Number(valueUsd) > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span
                style={{
                  fontSize: '14px',
                  color: 'rgba(255,255,255,0.4)',
                  letterSpacing: '0.1em'
                }}
              >
                POSITION VALUE
              </span>
              <span
                style={{
                  fontSize: '28px',
                  fontWeight: 'bold',
                  color: MOSS_GREEN,
                  fontFamily: 'monospace'
                }}
              >
                $
                {Number(valueUsd).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2
                })}
              </span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            position: 'relative',
            zIndex: 10,
            width: '100%',
            marginTop: 'auto'
          }}
        >
          <span
            style={{
              fontSize: '14px',
              color: 'rgba(255,255,255,0.35)',
              letterSpacing: '0.1em'
            }}
          >
            m00nad.vercel.app
          </span>
          {points && Number(points) > 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '14px', color: 'rgba(255,255,255,0.5)' }}>⭐</span>
              <span
                style={{
                  fontSize: '16px',
                  color: '#ffd700',
                  fontWeight: 'bold'
                }}
              >
                {Number(points).toLocaleString()} pts
              </span>
            </div>
          ) : (
            <span
              style={{
                fontSize: '15px',
                color: ACCENT_PURPLE,
                fontWeight: 500
              }}
            >
              Deploy LP 🌙
            </span>
          )}
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 800 // Farcaster requires 3:2 aspect ratio
    }
  );
}
