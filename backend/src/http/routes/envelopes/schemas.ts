import { z } from 'zod';

export { IdParam, parseId } from '../../../lib/http.js';

export const signedDecimal = z
  .string()
  .regex(/^-?\d+(\.\d{1,2})?$/, 'must be a decimal with up to 2 fraction digits');

export const monthStr = z
  .string()
  .regex(/^\d{4}-\d{2}$/, 'must be YYYY-MM')
  .transform((s) => `${s}-01`);

export const currency = z.string().regex(/^[A-Z]{3}$/, 'must be a 3-letter currency code');
