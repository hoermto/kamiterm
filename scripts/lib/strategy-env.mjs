/**
 * Strategy extras for the legacy research scripts (n-sweep, 10y-compare, walk-forward, param-grid,
 * strategy-variant-compare): TRAIL / TRAILLOCK / RANKING from CLI (--trail 20 --trail-lock 4 --ranking MOM52_4)
 * or env (RSL_TRAIL, RSL_TRAILLOCK, RSL_RANKING). Nothing set → {} → engine defaults (previous results unchanged).
 */
import { normStrategy, isDefaultStrategy } from './rsl-eval-core.mjs';

function argVal(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const raw = {
  trail: argVal('trail') ?? process.env.RSL_TRAIL,
  trailLock: argVal('trail-lock') ?? process.env.RSL_TRAILLOCK,
  ranking: argVal('ranking') ?? process.env.RSL_RANKING,
};
const set = Object.values(raw).some((v) => v != null && v !== '');
/** Spread into rotationBacktest opts / grid jobs. Empty object when nothing was set. */
export const STRATEGY = set ? normStrategy(raw) : {};
export const STRATEGY_TAG = set && !isDefaultStrategy(STRATEGY)
  ? `TRAIL=${STRATEGY.trail}${STRATEGY.trail > 0 ? `/${STRATEGY.trailLock}` : ''} RANKING=${STRATEGY.ranking}` : '';
if (STRATEGY_TAG) console.log('Strategie-Extras:', STRATEGY_TAG);
