export function getMoveBadgeSvg(category) {
  switch (category) {
    case 'brilliant':
      return `<svg viewBox="0 0 24 24" width="100%" height="100%">
        <circle cx="12" cy="12" r="11" fill="#1baca6" stroke="#ffffff" stroke-width="1.8"/>
        <text x="8.5" y="16.5" font-family="Arial, sans-serif" font-weight="900" font-size="12" fill="#ffffff" text-anchor="middle">!</text>
        <text x="15.5" y="16.5" font-family="Arial, sans-serif" font-weight="900" font-size="12" fill="#ffffff" text-anchor="middle">!</text>
      </svg>`;
    case 'great':
      return `<svg viewBox="0 0 24 24" width="100%" height="100%">
        <circle cx="12" cy="12" r="11" fill="#5b8bb0" stroke="#ffffff" stroke-width="1.8"/>
        <text x="12" y="17" font-family="Arial, sans-serif" font-weight="900" font-size="14" fill="#ffffff" text-anchor="middle">!</text>
      </svg>`;
    case 'best':
      return `<svg viewBox="0 0 24 24" width="100%" height="100%">
        <circle cx="12" cy="12" r="11" fill="#81b64c" stroke="#ffffff" stroke-width="1.8"/>
        <path d="M12 5.5l2 4.2 4.5.6-3.3 3.1.8 4.6-4-2.2-4 2.2.8-4.6-3.3-3.1 4.5-.6z" fill="#ffffff"/>
      </svg>`;
    case 'excellent':
      return `<svg viewBox="0 0 24 24" width="100%" height="100%">
        <circle cx="12" cy="12" r="11" fill="#96bc76" stroke="#ffffff" stroke-width="1.8"/>
        <path d="M7 12.5l3.2 3.2 7-7.2" fill="none" stroke="#ffffff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`;
    case 'good':
      return `<svg viewBox="0 0 24 24" width="100%" height="100%">
        <circle cx="12" cy="12" r="11" fill="#86b59b" stroke="#ffffff" stroke-width="1.8"/>
        <path d="M7.5 12.5l3 3 6.5-6.5" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`;
    case 'book':
      return `<svg viewBox="0 0 24 24" width="100%" height="100%">
        <circle cx="12" cy="12" r="11" fill="#d5a47e" stroke="#ffffff" stroke-width="1.8"/>
        <path d="M12 8.5c-1.8-1.2-4-1.2-5.5-.5v8c1.5-.7 3.7-.7 5.5.5 1.8-1.2 4-1.2 5.5-.5v-8c-1.5-.7-3.7-.7-5.5.5z" fill="#ffffff"/>
        <line x1="12" y1="8.5" x2="12" y2="16.5" stroke="#d5a47e" stroke-width="1.2"/>
      </svg>`;
    case 'inaccuracy':
      return `<svg viewBox="0 0 24 24" width="100%" height="100%">
        <circle cx="12" cy="12" r="11" fill="#f7c631" stroke="#ffffff" stroke-width="1.8"/>
        <text x="12" y="16.5" font-family="Arial, sans-serif" font-weight="900" font-size="12" fill="#1e2320" text-anchor="middle">?!</text>
      </svg>`;
    case 'mistake':
      return `<svg viewBox="0 0 24 24" width="100%" height="100%">
        <circle cx="12" cy="12" r="11" fill="#ffa459" stroke="#ffffff" stroke-width="1.8"/>
        <text x="12" y="17" font-family="Arial, sans-serif" font-weight="900" font-size="14" fill="#ffffff" text-anchor="middle">?</text>
      </svg>`;
    case 'miss':
      return `<svg viewBox="0 0 24 24" width="100%" height="100%">
        <circle cx="12" cy="12" r="11" fill="#fa7069" stroke="#ffffff" stroke-width="1.8"/>
        <path d="M8 8l8 8M16 8l-8 8" stroke="#ffffff" stroke-width="2.6" stroke-linecap="round"/>
      </svg>`;
    case 'blunder':
      return `<svg viewBox="0 0 24 24" width="100%" height="100%">
        <circle cx="12" cy="12" r="11" fill="#fa412d" stroke="#ffffff" stroke-width="1.8"/>
        <text x="8.5" y="16.5" font-family="Arial, sans-serif" font-weight="900" font-size="12" fill="#ffffff" text-anchor="middle">?</text>
        <text x="15.5" y="16.5" font-family="Arial, sans-serif" font-weight="900" font-size="12" fill="#ffffff" text-anchor="middle">?</text>
      </svg>`;
    default:
      return '';
  }
}
