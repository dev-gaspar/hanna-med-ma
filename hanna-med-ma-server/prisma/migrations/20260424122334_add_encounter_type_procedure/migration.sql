-- Add PROCEDURE to EncounterType enum
-- Surgical / bedside procedure visit (CPT 1xxxx-7xxxx is primary, no E/M family applies).

ALTER TYPE "EncounterType" ADD VALUE 'PROCEDURE';
