'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  computeSatelliteOrbit,
  formatUsd,
  normalizeM00nRadii,
  truncateAddress
} from '@/app/lib/m00nSolarSystem';
import type { LpPosition } from '@/app/lib/m00nSolarSystem.types';

export interface M00nSolarSystemProps {
  positions: LpPosition[];
  width?: number;
  height?: number;
}

type PreparedPlanet = LpPosition & {
  radius: number;
  share: number;
  isCenter: boolean;
};

type PlanetRenderState = {
  idx: number;
  x: number;
  y: number;
  radius: number;
};

interface StarPoint {
  x: number;
  y: number;
  radius: number;
  alpha: number;
}

const PLANET_TEXTURE_SRC = '/assets/m00nsvg.svg';
const STAR_COUNT = 72;

function createStarfield(width: number, height: number, count: number): StarPoint[] {
  return Array.from({ length: count }).map(() => ({
    x: Math.random() * width,
    y: Math.random() * height,
    radius: Math.random() * 1.2 + 0.2,
    alpha: 0.2 + Math.random() * 0.5
  }));
}

export function M00nSolarSystem({ positions, width = 480, height = 480 }: M00nSolarSystemProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textureRef = useRef<HTMLImageElement | null>(null);
  const planetsRef = useRef<PlanetRenderState[]>([]);
  const [tooltip, setTooltip] = useState<{
    entry: PreparedPlanet;
    x: number;
    y: number;
  } | null>(null);

  const preparedPlanets = useMemo<PreparedPlanet[]>(() => {
    if (!positions || positions.length === 0) return [];
    const sorted = [...positions].sort((a, b) => b.notionalUsd - a.notionalUsd).slice(0, 8);
    const radii = normalizeM00nRadii(sorted, {
      minRadius: 24,
      maxRadius: Math.min(width, height) * 0.18
    });
    const totalUsd =
      sorted.reduce((acc, position) => acc + Math.max(position.notionalUsd, 0), 0) || 1;
    return sorted.map((position, index) => ({
      ...position,
      radius: radii[index] ?? 32,
      share: Math.max(position.notionalUsd, 0) / totalUsd,
      isCenter: index === 0
    }));
  }, [positions, width, height]);

  const stars = useMemo(() => createStarfield(width, height, STAR_COUNT), [width, height]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (preparedPlanets.length === 0) {
      ctx.clearRect(0, 0, width, height);
      return;
    }

    let animationFrameId: number;
    let cancelled = false;

    const configureCanvas = () => {
      const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
    };

    const draw = (time: number) => {
      if (cancelled || !textureRef.current) return;
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, width, height);
      stars.forEach((star) => {
        ctx.fillStyle = `rgba(255,255,255,${star.alpha})`;
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
        ctx.fill();
      });

      const centerX = width / 2;
      const centerY = height / 2;
      const centerPlanet = preparedPlanets[0];
      const satellitePlanets = preparedPlanets.slice(1);
      const baseDimension = Math.min(width, height);
      const orbitBase =
        centerPlanet !== undefined
          ? centerPlanet.radius + Math.max(28, baseDimension * 0.05)
          : baseDimension * 0.18;
      const orbitStep = baseDimension * 0.09;
      const texture = textureRef.current;
      const renderStates: PlanetRenderState[] = [];

      const drawPlanet = (planet: PreparedPlanet, x: number, y: number) => {
        const planetRadius = planet.radius;
        const diameter = planetRadius * 2;
        const overscan = planet.isCenter ? 1.02 : 1.12;
        const drawSize = diameter * overscan;
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, planetRadius, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(texture, x - drawSize / 2, y - drawSize / 2, drawSize, drawSize);
        ctx.restore();
      };

      // Center planet
      drawPlanet(centerPlanet, centerX, centerY);
      renderStates.push({ idx: 0, x: centerX, y: centerY, radius: centerPlanet.radius });

      satellitePlanets.forEach((planet, satelliteIdx) => {
        const { x, y, orbitRadius } = computeSatelliteOrbit(satelliteIdx, satellitePlanets.length, {
          centerX,
          centerY,
          orbitBase,
          orbitStep,
          timeMs: time,
          rotationSpeed: 0.00012
        });

        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 8]);
        ctx.beginPath();
        ctx.arc(centerX, centerY, orbitRadius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        drawPlanet(planet, x, y);
        renderStates.push({
          idx: satelliteIdx + 1,
          x,
          y,
          radius: planet.radius
        });
      });

      planetsRef.current = renderStates;
      animationFrameId = requestAnimationFrame(draw);
    };

    const start = () => {
      if (cancelled) return;
      configureCanvas();
      animationFrameId = requestAnimationFrame(draw);
    };

    const ensureTexture = () => {
      if (textureRef.current && textureRef.current.complete) {
        start();
        return;
      }

      const image = new Image();
      image.src = PLANET_TEXTURE_SRC;
      image.onload = () => {
        textureRef.current = image;
        start();
      };
      image.onerror = (error) => {
        console.error('[M00nSolarSystem] Failed to load planet texture', error);
      };
    };

    ensureTexture();

    return () => {
      cancelled = true;
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [preparedPlanets, width, height, stars]);

  const getDisplayName = useCallback(
    (entry: PreparedPlanet) =>
      entry.isClankerPool ? 'Clanker Pool' : (entry.label ?? truncateAddress(entry.owner)),
    []
  );

  const handlePointerInteract = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      event.preventDefault();
      if (!canvasRef.current || preparedPlanets.length === 0) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const tooltipX = event.clientX - rect.left;
      const tooltipY = event.clientY - rect.top;
      const hovered = planetsRef.current.find((planet) => {
        const dx = tooltipX - planet.x;
        const dy = tooltipY - planet.y;
        return Math.sqrt(dx * dx + dy * dy) <= planet.radius;
      });
      if (!hovered) {
        setTooltip(null);
        return;
      }
      const entry = preparedPlanets[hovered.idx];
      if (!entry) {
        setTooltip(null);
        return;
      }
      setTooltip({
        entry,
        x: tooltipX,
        y: tooltipY
      });
    },
    [preparedPlanets]
  );

  const handlePointerLeave = useCallback(() => setTooltip(null), []);

  if (preparedPlanets.length === 0) {
    return (
      <div className="relative w-full rounded-3xl bg-black/80 p-6 text-center text-sm text-white/70 shadow-[0_0_30px_rgba(0,0,0,0.45)]">
        LP telemetry unavailable. Waiting for sigils to report in…
      </div>
    );
  }

  const tooltipContent = tooltip ? (
    <div
      className="pointer-events-none absolute z-10 min-w-[180px] rounded-xl border border-white/15 bg-black/90 px-4 py-3 text-left text-xs text-white shadow-2xl backdrop-blur"
      style={{
        left: Math.min(Math.max(tooltip.x + 16, 0), width - 160),
        top: Math.max(tooltip.y - 100, 8)
      }}
    >
      <p className="font-semibold text-[var(--monad-purple)]">{getDisplayName(tooltip.entry)}</p>
      <p className="mt-1 text-sm font-semibold">{formatUsd(tooltip.entry.notionalUsd)}</p>
      <p className="text-[11px] text-white/70">
        {(tooltip.entry.share * 100).toFixed(1)}% of LP notional
      </p>
      {(tooltip.entry.tickLower ?? tooltip.entry.tickUpper) !== undefined && (
        <p className="mt-1 text-[11px] text-white/60">
          Tick {tooltip.entry.tickLower ?? '—'} → {tooltip.entry.tickUpper ?? '—'}
        </p>
      )}
    </div>
  ) : null;

  return (
    <div
      className="relative mx-auto flex w-full max-w-full flex-col items-center justify-center rounded-[32px] bg-black p-4 text-white shadow-[0_0_60px_rgba(0,0,0,0.65)]"
      style={{ width, height }}
    >
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{ width: '100%', height: '100%', cursor: 'pointer' }}
        onPointerMove={handlePointerInteract}
        onPointerDown={handlePointerInteract}
        onPointerLeave={handlePointerLeave}
      />
      {tooltipContent}
    </div>
  );
}

export default M00nSolarSystem;

/**
 * Example usage:
 *
 * import { M00nSolarSystem } from '@/app/components/M00nSolarSystem';
 *
 * <M00nSolarSystem positions={topM00nPositions} width={480} height={480} />
 */
