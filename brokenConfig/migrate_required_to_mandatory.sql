-- Migration script to rename 'required' column to 'mandatory'
-- Run this on your existing xmuao_mods database

-- Rename the column from 'required' to 'mandatory'
ALTER TABLE `mods` CHANGE `required` `mandatory` TINYINT(1) DEFAULT 0;

-- Add index for the mandatory field if it doesn't exist
CREATE INDEX IF NOT EXISTS `idx_mandatory` ON `mods` (`mandatory`);

-- Verify the change
-- SELECT * FROM mods LIMIT 1;
