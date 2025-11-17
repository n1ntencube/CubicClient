-- Migration script to rename 'required' column to 'mandatory'
-- Run this on your existing xmuao_mods database if you have a 'required' column

-- Check if 'required' column exists and rename it to 'mandatory'
-- If your table already has 'mandatory', skip this step

-- Rename the column from 'required' to 'mandatory'
ALTER TABLE `mods` CHANGE `required` `mandatory` TINYINT(1) DEFAULT 0;

-- Add index for the mandatory field if it doesn't exist
ALTER TABLE `mods` ADD INDEX IF NOT EXISTS `idx_mandatory` (`mandatory`);

-- Verify the change
-- SELECT * FROM mods LIMIT 5;
