import { ImageResponse } from '@vercel/og';
import { NextRequest } from 'next/server';

export const runtime = 'edge';

// m00n brand colors
const MOSS_GREEN = '#6ce5b1';
const DEEP_PURPLE = '#1a0a2e';
const ACCENT_PURPLE = '#8c54ff';

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
  const mcap = searchParams.get('mcap');

  // Determine status color and emoji
  const isInRange = rangeStatus === 'in-range';
  const statusColor = isInRange ? MOSS_GREEN : '#ff6b6b';
  const statusEmoji = isInRange ? '✅' : '⚠️';
  const statusText = isInRange ? 'IN RANGE' : 'OUT OF RANGE';

  // Format band type for display
  const bandDisplay = bandType
    .replace('_', ' ')
    .replace('crash band', '🔻 CRASH BAND')
    .replace('upside band', '🚀 SKY BAND')
    .replace('sky band', '🚀 SKY BAND')
    .replace('custom', '🎯 CUSTOM');

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
          fontFamily: 'system-ui, sans-serif'
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '30px'
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
              m00n LP
            </span>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              backgroundColor: 'rgba(255,255,255,0.1)',
              padding: '8px 16px',
              borderRadius: '20px'
            }}
          >
            <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: '18px' }}>@{username}</span>
          </div>
        </div>

        {/* Main Card */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: 'rgba(255,255,255,0.05)',
            borderRadius: '24px',
            padding: '32px',
            border: `2px solid ${statusColor}40`,
            flex: 1
          }}
        >
          {/* Position ID + Type */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '24px'
            }}
          >
            <span
              style={{
                fontSize: '24px',
                color: 'rgba(255,255,255,0.6)',
                fontFamily: 'monospace'
              }}
            >
              #{tokenId}
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
              marginBottom: '32px'
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                backgroundColor: `${statusColor}20`,
                padding: '12px 24px',
                borderRadius: '12px',
                border: `1px solid ${statusColor}`
              }}
            >
              <span style={{ fontSize: '24px' }}>{statusEmoji}</span>
              <span
                style={{
                  fontSize: '20px',
                  fontWeight: 'bold',
                  color: statusColor,
                  letterSpacing: '0.1em'
                }}
              >
                {statusText}
              </span>
            </div>
          </div>

          {/* Range Display */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
              marginBottom: '24px'
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}
            >
              <span style={{ fontSize: '18px', color: 'rgba(255,255,255,0.5)' }}>RANGE</span>
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

            {mcap && (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}
              >
                <span style={{ fontSize: '18px', color: 'rgba(255,255,255,0.5)' }}>
                  CURRENT MCAP
                </span>
                <span
                  style={{
                    fontSize: '24px',
                    color: MOSS_GREEN,
                    fontFamily: 'monospace'
                  }}
                >
                  ${Number(mcap).toLocaleString()}
                </span>
              </div>
            )}

            {feesUsd && (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}
              >
                <span style={{ fontSize: '18px', color: 'rgba(255,255,255,0.5)' }}>
                  FEES EARNED
                </span>
                <span
                  style={{
                    fontSize: '24px',
                    color: MOSS_GREEN,
                    fontWeight: 'bold'
                  }}
                >
                  ${Number(feesUsd).toFixed(2)}
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
            marginTop: '20px'
          }}
        >
          <span
            style={{
              fontSize: '16px',
              color: 'rgba(255,255,255,0.4)',
              letterSpacing: '0.2em'
            }}
          >
            m00ncabal.xyz
          </span>
          <span
            style={{
              fontSize: '14px',
              color: 'rgba(255,255,255,0.3)'
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
