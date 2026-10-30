type Props = { rating: number | string | null | undefined; reviewCount: number | string | null | undefined; variant?: 'compact' | 'full' };

export function RatingDisplay({ rating, reviewCount, variant = 'full' }: Props) {
  const count = Number(reviewCount || 0), score = Number(rating), hasRating = count > 0 && Number.isFinite(score) && score >= 1 && score <= 5;
  const value = hasRating ? score.toFixed(1) : null;
  if (variant === 'compact') return <span className="rating-indicator rating-indicator-compact"><span className="rating-star" aria-hidden="true">★</span>{hasRating ? <>{value} · {count} {count === 1 ? 'review' : 'reviews'}</> : 'No ratings yet'}</span>;
  return <span className="rating-indicator rating-indicator-full">
    <span className="rating-stars" role="img" aria-label={hasRating ? `${value} out of 5 stars` : 'No ratings yet'}>
      <span className="rating-stars-empty" aria-hidden="true">★★★★★</span>
      {hasRating && <span className="rating-stars-fill" style={{ width: `${score / 5 * 100}%` }} aria-hidden="true">★★★★★</span>}
    </span>
    <span>{hasRating ? value : 'No ratings yet'}</span>
    {hasRating && <small>({count} {count === 1 ? 'review' : 'reviews'})</small>}
  </span>;
}
