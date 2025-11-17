-- CubicLauncher Mods Database Schema
-- Run this SQL script in your MySQL database to create the mods table

CREATE TABLE IF NOT EXISTS `mods` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `mod_name` VARCHAR(255) NOT NULL,
  `mod_url` VARCHAR(500) NOT NULL,
  `mod_version` VARCHAR(50) DEFAULT NULL,
  `enabled` TINYINT(1) DEFAULT 1,
  `mandatory` TINYINT(1) DEFAULT 0,
  `description` TEXT DEFAULT NULL,
  `minecraft_version` VARCHAR(20) DEFAULT '1.12.2',
  `file_size` BIGINT DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_enabled` (`enabled`),
  INDEX `idx_mandatory` (`mandatory`),
  INDEX `idx_minecraft_version` (`minecraft_version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Example mod entries (you can customize these)
INSERT INTO `mods` (`mod_name`, `mod_url`, `mod_version`, `enabled`, `mandatory`, `description`) VALUES
('JEI', 'https://cdn.nintencube.fr/mods/jei-1.12.2-4.16.1.301.jar', '4.16.1.301', 0, 0, 'Just Enough Items - Recipe viewer and item list manager'),
('OptiFine', 'https://cdn.nintencube.fr/mods/OptiFine_1.12.2_HD_U_G5.jar', 'HD_U_G5', 0, 0, 'Performance and graphics optimization mod'),
('Biomes O Plenty', 'https://cdn.nintencube.fr/mods/BiomesOPlenty-1.12.2-7.0.1.2445.jar', '7.0.1.2445', 0, 0, 'Adds over 80 unique biomes to the game'),
('Tinkers Construct', 'https://cdn.nintencube.fr/mods/TConstruct-1.12.2-2.13.0.183.jar', '2.13.0.183', 0, 0, 'Tool crafting and customization system'),
('Iron Chests', 'https://cdn.nintencube.fr/mods/ironchest-1.12.2-7.0.72.847.jar', '7.0.72.847', 0, 0, 'Adds larger storage chest variants'),
('JourneyMap', 'https://cdn.nintencube.fr/mods/journeymap-1.12.2-5.7.1.jar', '5.7.1', 0, 0, 'Real-time mapping and waypoint system'),
('Inventory Tweaks', 'https://cdn.nintencube.fr/mods/InventoryTweaks-1.64+dev.151.jar', '1.64', 0, 0, 'Automatic inventory sorting and organization'),
('AppleSkin', 'https://cdn.nintencube.fr/mods/AppleSkin-mc1.12-1.0.14.jar', '1.0.14', 0, 0, 'Shows food and saturation values in tooltips'),
('Better Advancements', 'https://cdn.nintencube.fr/mods/BetterAdvancements-1.12.2-0.1.0.77.jar', '0.1.0.77', 0, 0, 'Improves the advancement screen UI'),
('FastLeafDecay', 'https://cdn.nintencube.fr/mods/FastLeafDecay-v14.jar', 'v14', 0, 0, 'Makes leaves decay faster after cutting trees');

-- Query to view all enabled mods (what the launcher will fetch)
-- SELECT mod_name, mod_url, mod_version, enabled, mandatory FROM mods WHERE enabled = 1 ORDER BY mod_name;

-- To disable a mod without deleting it
-- UPDATE mods SET enabled = 0 WHERE mod_name = 'ModName';

-- To enable a mod
-- UPDATE mods SET enabled = 1 WHERE mod_name = 'ModName';

-- To mark a mod as mandatory (cannot be disabled by users)
-- UPDATE mods SET mandatory = 1 WHERE mod_name = 'ModName';

-- To add a new mod
-- INSERT INTO mods (mod_name, mod_url, mod_version, enabled, mandatory, description) 
-- VALUES ('ModName', 'https://url.to/mod.jar', '1.0.0', 1, 0, 'Description');
