const colors = ["#359EEE", "#FFC43D", "#EF476F", "#03CEA4"];

export function TokenlessOrb() {
  return (
    <div className="w-full" aria-hidden="true">
      <svg className="tokenless-orb h-auto w-full" viewBox="150 140 500 360" role="presentation">
        {Array.from({ length: 30 }, (_, index) => (
          <ellipse
            key={index}
            cx="400"
            cy="300"
            rx={110 + index * 1.4}
            ry={Math.max(42, 110 - index * 2.25)}
            fill="none"
            stroke={colors[index % colors.length]}
            strokeOpacity={Math.max(0.08, 0.76 - index / 38)}
            strokeWidth="1.4"
            style={{ animationDelay: `${(index / 30) * -7}s`, animationDuration: `${6 + (index % 5) * 0.35}s` }}
          />
        ))}
      </svg>
    </div>
  );
}
