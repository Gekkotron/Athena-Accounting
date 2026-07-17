import { describe, it, expect } from 'vitest';
import i18n from '../../i18n';
import { pinLocale } from '../../test/i18n';
import { errorMessage } from '../errorMessage';
import { ApiError } from '../client';

// Preload the 'imports' namespace (where the backend-error translations
// live) for both locales, then pin the active language to French — matches
// the pattern used by every other test that exercises `t(...)`.
pinLocale('imports');

describe('errorMessage', () => {
  it('translates a coded ApiError (pdf_encrypted) into French', () => {
    const err = new ApiError('PDF is password-protected', 400, { code: 'pdf_encrypted', error: 'PDF is password-protected' });
    expect(errorMessage(err, i18n.t)).toBe('Le PDF est protégé par un mot de passe');
  });

  it('translates needs_template + reason "template_stale" into its specific French variant', () => {
    const err = new ApiError('saved template no longer matches this PDF; re-train it via Athena import', 422, {
      code: 'needs_template',
      reason: 'template_stale',
      error: 'saved template no longer matches this PDF; re-train it via Athena import',
    });
    expect(errorMessage(err, i18n.t)).toBe(
      'Le modèle enregistré ne correspond plus à ce PDF ; ré-entraînez-le via l\'import d\'Athena',
    );
  });

  it('falls back to err.message for an unknown code', () => {
    const err = new ApiError('some unmapped backend error', 400, { code: 'some_other_code', error: 'some unmapped backend error' });
    expect(errorMessage(err, i18n.t)).toBe('some unmapped backend error');
  });

  it('falls back to err.message for a plain (non-ApiError) Error', () => {
    const err = new Error('network exploded');
    expect(errorMessage(err, i18n.t)).toBe('network exploded');
  });

  it('falls back to a generic message for a non-Error value', () => {
    expect(errorMessage(null, i18n.t)).toBe('Erreur');
  });
});
