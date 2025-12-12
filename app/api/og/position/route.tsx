import { ImageResponse } from '@vercel/og';
import { NextRequest } from 'next/server';

export const runtime = 'edge';

// m00n brand colors
const MOSS_GREEN = '#6ce5b1';
const DEEP_PURPLE = '#0a0612';
const ACCENT_PURPLE = '#8c54ff';

// Star positions for background
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
  const username = searchParams.get('username') ?? 'anon';
  const valueUsd = searchParams.get('valueUsd');

  // Determine status color and emoji
  const isInRange = rangeStatus === 'in-range';
  const statusColor = isInRange ? MOSS_GREEN : '#ff6b6b';
  const statusEmoji = isInRange ? '✅' : '⚠️';
  const statusText = isInRange ? 'IN RANGE' : 'OUT OF RANGE';

  // Format band type for display
  let bandDisplay = '🎯 CUSTOM';
  let bandDescription = 'Custom price range';
  if (bandType === 'crash_band') {
    bandDisplay = '🔻 CRASH BAND';
    bandDescription = 'Hedging against downside';
  } else if (bandType === 'upside_band') {
    bandDisplay = '🚀 SKY BAND';
    bandDescription = 'Betting on the moon';
  }

  // Position ID display
  const positionDisplay = tokenId === 'new' ? '✨ JUST DEPLOYED' : `Position #${tokenId}`;

  // Calculate range width percentage
  const lowerNum = Number(rangeLower) || 0;
  const upperNum = Number(rangeUpper) || 0;
  const rangeWidth = lowerNum > 0 ? Math.round(((upperNum - lowerNum) / lowerNum) * 100) : 0;

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
            marginBottom: '20px',
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
            <span style={{ fontSize: '44px' }}>🌙</span>
            <span
              style={{
                fontSize: '28px',
                fontWeight: 'bold',
                color: 'white',
                letterSpacing: '0.08em'
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
            <span style={{ color: 'white', fontSize: '16px', fontWeight: 500 }}>@{username}</span>
          </div>
        </div>

        {/* Main Card */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: 'rgba(26, 10, 46, 0.85)',
            borderRadius: '24px',
            padding: '28px',
            border: '1px solid rgba(140, 84, 255, 0.3)',
            flex: 1,
            position: 'relative',
            zIndex: 10
          }}
        >
          {/* Top row: Position ID + Band Type */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '16px'
            }}
          >
            <span
              style={{
                fontSize: '20px',
                color: 'rgba(255,255,255,0.7)',
                fontWeight: 600
              }}
            >
              {positionDisplay}
            </span>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-end'
              }}
            >
              <span
                style={{
                  fontSize: '18px',
                  color: ACCENT_PURPLE,
                  letterSpacing: '0.12em',
                  fontWeight: 'bold'
                }}
              >
                {bandDisplay}
              </span>
              <span
                style={{
                  fontSize: '12px',
                  color: 'rgba(255,255,255,0.4)',
                  marginTop: '4px'
                }}
              >
                {bandDescription}
              </span>
            </div>
          </div>

          {/* Status Badge */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '16px',
              marginBottom: '24px'
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
              <span style={{ fontSize: '20px' }}>{statusEmoji}</span>
              <span
                style={{
                  fontSize: '16px',
                  fontWeight: 'bold',
                  color: statusColor,
                  letterSpacing: '0.08em'
                }}
              >
                {statusText}
              </span>
            </div>
            {isInRange && (
              <span
                style={{
                  fontSize: '14px',
                  color: MOSS_GREEN,
                  fontWeight: 500
                }}
              >
                💰 Earning fees
              </span>
            )}
          </div>

          {/* Stats Grid - 3 equal columns */}
          <div
            style={{
              display: 'flex',
              gap: '20px',
              flex: 1
            }}
          >
            {/* Column 1 - Price Range */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                flex: 1,
                backgroundColor: 'rgba(255,255,255,0.03)',
                padding: '20px',
                borderRadius: '16px',
                border: '1px solid rgba(255,255,255,0.08)',
                justifyContent: 'center'
              }}
            >
              <span
                style={{
                  fontSize: '11px',
                  color: 'rgba(255,255,255,0.4)',
                  letterSpacing: '0.12em',
                  marginBottom: '12px',
                  textTransform: 'uppercase'
                }}
              >
                Price Range
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span
                  style={{
                    fontSize: '22px',
                    fontWeight: 'bold',
                    color: 'white',
                    fontFamily: 'monospace'
                  }}
                >
                  ${lowerNum.toLocaleString()}
                </span>
                <span
                  style={{
                    fontSize: '12px',
                    color: 'rgba(255,255,255,0.4)'
                  }}
                >
                  to
                </span>
                <span
                  style={{
                    fontSize: '22px',
                    fontWeight: 'bold',
                    color: 'white',
                    fontFamily: 'monospace'
                  }}
                >
                  ${upperNum.toLocaleString()}
                </span>
              </div>
            </div>

            {/* Column 2 - Range Width */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                flex: 1,
                backgroundColor: 'rgba(140, 84, 255, 0.08)',
                padding: '20px',
                borderRadius: '16px',
                border: `1px solid ${ACCENT_PURPLE}30`,
                justifyContent: 'center'
              }}
            >
              <span
                style={{
                  fontSize: '11px',
                  color: 'rgba(255,255,255,0.4)',
                  letterSpacing: '0.12em',
                  marginBottom: '12px',
                  textTransform: 'uppercase'
                }}
              >
                Range Width
              </span>
              <span
                style={{
                  fontSize: '32px',
                  fontWeight: 'bold',
                  color: ACCENT_PURPLE,
                  fontFamily: 'monospace'
                }}
              >
                +{rangeWidth}%
              </span>
            </div>

            {/* Column 3 - Position Value */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                flex: 1,
                backgroundColor: 'rgba(108, 229, 177, 0.08)',
                padding: '20px',
                borderRadius: '16px',
                border: `1px solid ${MOSS_GREEN}30`,
                justifyContent: 'center'
              }}
            >
              <span
                style={{
                  fontSize: '11px',
                  color: 'rgba(255,255,255,0.4)',
                  letterSpacing: '0.12em',
                  marginBottom: '12px',
                  textTransform: 'uppercase'
                }}
              >
                {valueUsd ? 'Position Value' : 'Upside Target'}
              </span>
              <span
                style={{
                  fontSize: '32px',
                  fontWeight: 'bold',
                  color: MOSS_GREEN,
                  fontFamily: 'monospace'
                }}
              >
                {valueUsd
                  ? `$${Number(valueUsd).toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2
                    })}`
                  : `$${upperNum.toLocaleString()}`}
              </span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: '14px',
            position: 'relative',
            zIndex: 10
          }}
        >
          <span
            style={{
              fontSize: '13px',
              color: 'rgba(255,255,255,0.4)',
              letterSpacing: '0.12em'
            }}
          >
            m00ncabal.xyz
          </span>
          <span
            style={{
              fontSize: '13px',
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
      height: 800
    }
  );
}
