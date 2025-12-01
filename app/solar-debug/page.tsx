import M00nSolarSystem from '@/app/components/M00nSolarSystem';
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

  return (
    <main className="min-h-screen bg-black text-white p-6 space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="text-3xl font-semibold tracking-wide">LP Solar System Debug</h1>
        <p className="text-sm opacity-75">Updated {new Date(payload.updatedAt).toLocaleString()}</p>
      </div>

      <div className="flex justify-center">
        <M00nSolarSystem positions={payload.positions} width={640} height={640} />
      </div>

      <section className="bg-white/5 rounded-xl p-4 overflow-auto text-xs leading-relaxed">
        <pre className="whitespace-pre-wrap break-all">{JSON.stringify(payload, null, 2)}</pre>
      </section>
    </main>
  );
}
