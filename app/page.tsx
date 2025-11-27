export default function HomePage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 relative z-10">
      <div className="max-w-xl w-full text-center space-y-6">
        <h1 className="pixel-font text-2xl glow-purple">m00n Cabal Check</h1>

        <p className="text-lg opacity-90">
          Check your $m00n eligibility in the dedicated mini experience.
        </p>

        <p className="text-sm opacity-70">
          Launch it at <code className="bg-black/30 px-2 py-1 rounded">/miniapp</code> or open it
          inside Warpcast.
        </p>
      </div>
    </div>
  );
}
