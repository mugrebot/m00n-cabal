import { ImageResponse } from 'next/og';

export const runtime = 'edge';

const fontDataPromise = fetch(
  new URL('../../../public/fonts/PressStart2P-Regular.ttf', import.meta.url)
)
  .then((res) => res.arrayBuffer())
  .catch(() => undefined);

const formatAmount = (value?: string | null) => {
  if (!value) return '???';
  const normalized = value.replace(/[^\d]/g, '');
  if (!normalized) return '???';
  const numeric = Number.parseInt(normalized, 10);
  if (Number.isNaN(numeric)) {
    return normalized;
  }
  return new Intl.NumberFormat('en-US').format(numeric);
};

const shortAddress = (addr?: string | null) => {
  if (!addr) return '––––';
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 5)}…${addr.slice(-4)}`;
};

const getPlayerHandle = (
  username?: string | null,
  displayName?: string | null,
  fid?: string | null
) => {
  if (username) return `@${username}`;
  if (displayName) return displayName;
  if (fid) return `FID ${fid}`;
  return 'unknown cabalist';
};

export async function GET(request: Request) {
  const fontData = await fontDataPromise;
  const { searchParams } = new URL(request.url);

  const amount = formatAmount(searchParams.get('amount'));
  const username = searchParams.get('username');
  const displayName = searchParams.get('displayName');
  const fid = searchParams.get('fid');
  const tier = (searchParams.get('tier') ?? 'UNRANKED').toUpperCase();
  const wallet = shortAddress(searchParams.get('wallet'));
  const replies = searchParams.get('replies') ?? '0';
  const handle = getPlayerHandle(username, displayName, fid);

  const stripes = Array.from({ length: 14 }).map((_, idx) => ({
    top: 30 + idx * 55,
    opacity: 0.08 + (idx % 2 === 0 ? 0.04 : 0)
  }));

  const glitchBlocks = Array.from({ length: 18 }).map((_, idx) => ({
    left: 30 + ((idx * 67) % 1130),
    top: 40 + ((idx * 53) % 680),
    width: 12 + ((idx * 13) % 32),
    height: 8 + ((idx * 7) % 18),
    opacity: 0.15 + (idx % 3) * 0.12
  }));

  return new ImageResponse(
    (
      <div
        style={{
          width: '1200px',
          height: '800px',
          display: 'flex',
          flexDirection: 'column',
          background: '#07010f',
          color: '#f7e6ff',
          fontFamily: '"Press Start 2P", "Courier New", monospace',
          position: 'relative'
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: '32px',
            border: '8px solid #8c54ff',
            borderRadius: '24px',
            boxShadow: '0 0 60px rgba(140, 84, 255, 0.65)',
            background:
              'radial-gradient(circle at 20% 30%, rgba(140, 84, 255, 0.15), transparent 55%)'
          }}
        />

        {stripes.map((stripe, idx) => (
          <div
            key={`stripe-${idx}`}
            style={{
              position: 'absolute',
              left: '32px',
              right: '32px',
              top: `${stripe.top}px`,
              height: '12px',
              background: '#6ce5b1',
              opacity: stripe.opacity
            }}
          />
        ))}

        {glitchBlocks.map((block, idx) => (
          <div
            key={`glitch-${idx}`}
            style={{
              position: 'absolute',
              left: `${block.left}px`,
              top: `${block.top}px`,
              width: `${block.width}px`,
              height: `${block.height}px`,
              background: idx % 2 === 0 ? '#6ce5b1' : '#8c54ff',
              opacity: block.opacity
            }}
          />
        ))}

        <div
          style={{
            position: 'relative',
            zIndex: 2,
            padding: '80px',
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            justifyContent: 'space-between'
          }}
        >
          <div
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}
          >
            <div>
              <div
                style={{
                  fontSize: '22px',
                  letterSpacing: '8px',
                  color: '#6ce5b1',
                  marginBottom: '12px'
                }}
              >
                M00N CABAL CHECK
              </div>
              <div style={{ fontSize: '14px', letterSpacing: '6px' }}>
                SCAN YOUR FID - CLAIM YOUR LEDGER
              </div>
            </div>
            <div
              style={{
                padding: '16px 24px',
                border: '2px solid #6ce5b1',
                borderRadius: '16px',
                fontSize: '16px',
                letterSpacing: '6px'
              }}
            >
              {tier}
            </div>
          </div>

          <div
            style={{
              border: '4px solid #8c54ff',
              borderRadius: '24px',
              padding: '40px',
              background: 'rgba(12, 2, 25, 0.8)',
              boxShadow: '0 0 40px rgba(108, 229, 177, 0.2)'
            }}
          >
            <div
              style={{
                fontSize: '30px',
                letterSpacing: '8px',
                marginBottom: '20px',
                color: '#6ce5b1'
              }}
            >
              {amount} $M00N
            </div>
            <div style={{ fontSize: '18px', marginBottom: '8px' }}>{handle}</div>
            <div style={{ fontSize: '14px', color: '#8c54ff', letterSpacing: '6px' }}>
              WALLET {wallet} • REPLIES {replies}
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '14px',
              letterSpacing: '4px',
              color: '#6ce5b1',
              opacity: 0.8
            }}
          >
            <span>MONAD CABAL NETWORK</span>
            <span>VERIFY @ m00nad.vercel.app/miniapp</span>
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 800,
      fonts: fontData
        ? [
            {
              name: 'Press Start 2P',
              data: fontData,
              weight: 400,
              style: 'normal'
            }
          ]
        : undefined
    }
  );
}
