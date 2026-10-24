/**
 * DEPRECATED — the feedback card background is no longer baked from SVG.
 *
 * The card now uses the supplied wooden-parchment PNG verbatim (alpha-
 * trimmed only). Running this script simply re-installs that artwork via
 * scripts/prepare-feedback-card.mjs, so old invocations can never
 * overwrite the uploaded painting with the procedural stand-in.
 *
 * Output: public/assets/images/ui/feedback-card.webp (via prepare-feedback-
 *         card.mjs — WebP since the load-time optimization pass)
 * Run:    node scripts/build-feedback-card.mjs   (delegates)
 */
import './prepare-feedback-card.mjs';
