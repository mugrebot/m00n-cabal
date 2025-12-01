import M00nSolarSystem from '@/app/components/M00nSolarSystem';
import { formatUsd } from '@/app/lib/m00nSolarSystem';
import { buildSolarSystemPayload } from '@/app/lib/lpTelemetry';
import { readSolarSystemSnapshot } from '@/app/lib/lpTelemetryStore';

export const dynamic = 'force-dynamic';

export default async function SolarDebugPage() {
  let payload = await readSolarSystemSnapshot();

  if (!payload) {
    try {
      payload = await buildSolarSystemPayload(12);
    } catch (error) {
      console.error('[solar-debug] failed to build payload', error);
    }
  }

  if (!payload) {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center p-8">
        <div className="max-w-xl text-center space-y-4">
          <h1 className="text-2xl font-semibold">LP Solar System Debug</h1>
          <p className="text-sm opacity-80">
            Snapshot unavailable. Trigger the admin rebuild endpoint and refresh this page.
          </p>
        </div>
      </main>
    );
  }

  const totalNotionalUsd = payload.positions.reduce(
    (acc, position) => acc + Math.max(position.notionalUsd, 0),
    0
  );

  return (
    <main className="min-h-screen bg-black text-white p-6 space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="text-3xl font-semibold tracking-wide">LP Solar System Debug</h1>
        <p className="text-sm opacity-75">Updated {new Date(payload.updatedAt).toLocaleString()}</p>
      </div>

      <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center justify-center gap-4">
        <div className="flex min-w-[220px] flex-col rounded-2xl bg-black/80 p-4 text-center shadow-[0_0_30px_rgba(0,0,0,0.45)]">
          <span className="text-xs uppercase tracking-[0.2em] text-white/50">
            Total LP Notional
          </span>
          <span className="text-2xl font-semibold">{formatUsd(totalNotionalUsd)}</span>
        </div>
        <div className="flex min-w-[220px] flex-col rounded-2xl bg-black/80 p-4 text-center shadow-[0_0_30px_rgba(0,0,0,0.45)]">
          <span className="text-xs uppercase tracking-[0.2em] text-white/50">Sigils</span>
          <span className="text-2xl font-semibold">{payload.positions.length}</span>
        </div>
      </div>

      <div className="flex justify-center">
        <M00nSolarSystem positions={payload.positions} width={640} height={640} />
      </div>

      <section className="rounded-2xl border border-white/5 bg-black/80 p-4 text-xs leading-relaxed">
        <pre className="whitespace-pre-wrap break-all">{JSON.stringify(payload, null, 2)}</pre>
      </section>
    </main>
  );
}
