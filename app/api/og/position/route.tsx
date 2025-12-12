import { ImageResponse } from '@vercel/og';
import { NextRequest } from 'next/server';

export const runtime = 'edge';

// m00n brand colors
const MOSS_GREEN = '#6ce5b1';
const DEEP_PURPLE = '#0a0612';
const ACCENT_PURPLE = '#8c54ff';

// Generate star positions
const STAR_POSITIONS = [
  { x: 50, y: 60, s: 2 },
  { x: 120, y: 180, s: 1 },
  { x: 200, y: 40, s: 3 },
  { x: 300, y: 120, s: 2 },
  { x: 380, y: 200, s: 1 },
  { x: 450, y: 80, s: 2 },
  { x: 520, y: 150, s: 1 },
  { x: 600, y: 30, s: 3 },
  { x: 680, y: 100, s: 2 },
  { x: 750, y: 180, s: 1 },
  { x: 820, y: 50, s: 2 },
  { x: 900, y: 130, s: 1 },
  { x: 980, y: 70, s: 3 },
  { x: 1050, y: 160, s: 2 },
  { x: 1120, y: 40, s: 1 },
  { x: 80, y: 350, s: 1 },
  { x: 180, y: 400, s: 2 },
  { x: 280, y: 320, s: 1 },
  { x: 420, y: 380, s: 3 },
  { x: 550, y: 340, s: 1 },
  { x: 680, y: 420, s: 2 },
  { x: 800, y: 360, s: 1 },
  { x: 920, y: 400, s: 2 },
  { x: 1040, y: 340, s: 1 },
  { x: 60, y: 550, s: 2 },
  { x: 160, y: 620, s: 1 },
  { x: 260, y: 500, s: 3 },
  { x: 360, y: 580, s: 1 },
  { x: 500, y: 530, s: 2 },
  { x: 620, y: 600, s: 1 },
  { x: 740, y: 540, s: 2 },
  { x: 860, y: 610, s: 1 },
  { x: 980, y: 560, s: 3 },
  { x: 1100, y: 520, s: 1 },
  { x: 100, y: 700, s: 1 },
  { x: 300, y: 720, s: 2 },
  { x: 500, y: 680, s: 1 },
  { x: 700, y: 740, s: 2 },
  { x: 900, y: 700, s: 1 },
  { x: 1100, y: 750, s: 2 }
];

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  // Position data from query params
  const tokenId = searchParams.get('tokenId') ?? '???';
  const bandType = searchParams.get('bandType') ?? 'custom';
  const rangeStatus = searchParams.get('rangeStatus') ?? 'unknown';
  const rangeLower = searchParams.get('rangeLower') ?? '0';
  const rangeUpper = searchParams.get('rangeUpper') ?? '0';
  const feesUsd = searchParams.get('feesUsd');
  const username = searchParams.get('username') ?? 'anon';
  const valueUsd = searchParams.get('valueUsd');

  // Determine status color and emoji
  const isInRange = rangeStatus === 'in-range';
  const statusColor = isInRange ? MOSS_GREEN : '#ff6b6b';
  const statusEmoji = isInRange ? '✅' : '⚠️';
  const statusText = isInRange ? 'IN RANGE' : 'OUT OF RANGE';

  // Format band type for display
  let bandDisplay = '🎯 CUSTOM';
  if (bandType === 'crash_band') bandDisplay = '🔻 CRASH BAND';
  else if (bandType === 'upside_band') bandDisplay = '🚀 SKY BAND';

  // Position ID display
  const positionDisplay = tokenId === 'new' ? '✨ JUST DEPLOYED' : `#${tokenId}`;

  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: DEEP_PURPLE,
          padding: '40px',
          fontFamily: 'system-ui, sans-serif',
          position: 'relative',
          overflow: 'hidden'
        }}
      >
        {/* Starry background - static positions for satori compatibility */}
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
              opacity: 0.4 + (i % 5) * 0.1
            }}
          />
        ))}

        {/* Subtle gradient glow */}
        <div
          style={{
            position: 'absolute',
            top: '-100px',
            left: '200px',
            width: '400px',
            height: '400px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(140, 84, 255, 0.2) 0%, transparent 70%)',
            display: 'flex'
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: '-50px',
            right: '100px',
            width: '300px',
            height: '300px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(108, 229, 177, 0.15) 0%, transparent 70%)',
            display: 'flex'
          }}
        />

        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '24px',
            position: 'relative',
            zIndex: 10
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px'
            }}
          >
            <span style={{ fontSize: '48px' }}>🌙</span>
            <span
              style={{
                fontSize: '32px',
                fontWeight: 'bold',
                color: 'white',
                letterSpacing: '0.1em'
              }}
            >
              $m00n position
            </span>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              backgroundColor: 'rgba(255,255,255,0.1)',
              padding: '8px 16px',
              borderRadius: '20px',
              border: '1px solid rgba(255,255,255,0.2)'
            }}
          >
            <span style={{ color: 'white', fontSize: '18px', fontWeight: 500 }}>@{username}</span>
          </div>
        </div>

        {/* Main Card */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: 'rgba(26, 10, 46, 0.8)',
            borderRadius: '24px',
            padding: '32px',
            border: '1px solid rgba(140, 84, 255, 0.3)',
            flex: 1,
            position: 'relative',
            zIndex: 10
          }}
        >
          {/* Position ID + Type */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '20px'
            }}
          >
            <span
              style={{
                fontSize: '24px',
                color: 'rgba(255,255,255,0.6)',
                fontFamily: 'monospace'
              }}
            >
              {positionDisplay}
            </span>
            <span
              style={{
                fontSize: '20px',
                color: ACCENT_PURPLE,
                letterSpacing: '0.15em',
                fontWeight: 'bold'
              }}
            >
              {bandDisplay}
            </span>
          </div>

          {/* Status Badge */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              marginBottom: '28px'
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                backgroundColor: `${statusColor}15`,
                padding: '10px 20px',
                borderRadius: '12px',
                border: `1px solid ${statusColor}`
              }}
            >
              <span style={{ fontSize: '22px' }}>{statusEmoji}</span>
              <span
                style={{
                  fontSize: '18px',
                  fontWeight: 'bold',
                  color: statusColor,
                  letterSpacing: '0.1em'
                }}
              >
                {statusText}
              </span>
            </div>
          </div>

          {/* Stats Grid */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '20px'
            }}
          >
            {/* Range */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}
            >
              <span
                style={{ fontSize: '16px', color: 'rgba(255,255,255,0.5)', letterSpacing: '0.1em' }}
              >
                RANGE
              </span>
              <span
                style={{
                  fontSize: '28px',
                  fontWeight: 'bold',
                  color: 'white',
                  fontFamily: 'monospace'
                }}
              >
                ${Number(rangeLower).toLocaleString()} → ${Number(rangeUpper).toLocaleString()}
              </span>
            </div>

            {/* Position Value */}
            {valueUsd && (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}
              >
                <span
                  style={{
                    fontSize: '16px',
                    color: 'rgba(255,255,255,0.5)',
                    letterSpacing: '0.1em'
                  }}
                >
                  POSITION VALUE
                </span>
                <span
                  style={{
                    fontSize: '26px',
                    color: MOSS_GREEN,
                    fontFamily: 'monospace',
                    fontWeight: 'bold'
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

            {/* Fees Earned */}
            {feesUsd && Number(feesUsd) > 0 && (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}
              >
                <span
                  style={{
                    fontSize: '16px',
                    color: 'rgba(255,255,255,0.5)',
                    letterSpacing: '0.1em'
                  }}
                >
                  FEES EARNED
                </span>
                <span
                  style={{
                    fontSize: '24px',
                    color: MOSS_GREEN,
                    fontWeight: 'bold'
                  }}
                >
                  +${Number(feesUsd).toFixed(2)}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: '16px',
            position: 'relative',
            zIndex: 10
          }}
        >
          <span
            style={{
              fontSize: '14px',
              color: 'rgba(255,255,255,0.4)',
              letterSpacing: '0.15em'
            }}
          >
            m00ncabal.xyz
          </span>
          <span
            style={{
              fontSize: '14px',
              color: MOSS_GREEN,
              letterSpacing: '0.05em'
            }}
          >
            Tap to view in mini app →
          </span>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 800 // 3:2 aspect ratio required for Farcaster Mini App embeds
    }
  );
}
