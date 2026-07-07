// Divisor estructural entre secciones de la landing pública: un trazo de monitor
// cardíaco (línea plana + dos latidos), en vez de un <hr> genérico. Encodea la
// especialidad real de la doctora (ecocardiografía/ritmo) en vez de decorar.
export function EcgDivider({ animated = false, className = "" }: { animated?: boolean; className?: string }) {
  return (
    <div className={`w-full ${className}`} aria-hidden="true">
      <svg viewBox="0 0 800 48" preserveAspectRatio="none" className="h-6 w-full sm:h-8">
        <path
          d="M0,24 L100,24 L120,24 L128,10 L136,38 L144,4 L152,30 L160,24 L300,24 L400,24 L420,24 L428,10 L436,38 L444,4 L452,30 L460,24 L800,24"
          fill="none"
          stroke="var(--color-cardiac)"
          strokeOpacity={0.85}
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={animated ? "ecg-draw" : undefined}
        />
      </svg>
    </div>
  )
}
