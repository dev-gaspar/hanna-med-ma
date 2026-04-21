-- Normalise icd10_codes.code to the CMS-canonical dotted format
-- ("E11621" → "E11.621"). CMS publishes both shapes in different
-- files; our LCD cross-walk table already uses the dotted form, so
-- aligning icd10_codes with that one lets exact-match joins work
-- end-to-end. Dot rule: codes of length > 3 get "." inserted after
-- position 3; codes of length <= 3 (category headers) stay as-is.

UPDATE "icd10_codes"
   SET code = substring(code FROM 1 FOR 3) || '.' || substring(code FROM 4)
 WHERE length(code) > 3
   AND position('.' in code) = 0;

-- The unique index on (code) was already there from the initial
-- migration; it auto-updates with the rewritten values.
