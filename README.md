# CubicLauncher
Launcher pour accéder aux serveurs de NintenCube.

## Auto-Update System
The launcher automatically checks for updates on GitHub releases:
- Updates are checked on startup (3 seconds after launch)
- When an update is available, it downloads automatically
- Update installs when the launcher quits
- Only works in production builds (not in dev mode)

### Publishing a New Version
1. Update the `version` in `package.json` (e.g., "0.2.0" → "0.3.0")
2. Commit and push changes
3. Create a git tag: `git tag v0.3.0`
4. Push the tag: `git push origin v0.3.0`
5. GitHub Actions will build and create a release
6. Users will auto-update on next launch

# Todo
- [x] Authentification Microsoft
- [x] Lancement de Minecraft avec Forge 1.12.2 
- [ ] dl des fichiers automatiquement
- [ ] ajouter un slider pour la RAM
- [x] esthétique
- [x] le "mod shop" (en gros juste un endroit pour télécharger des mods en plus des mods obligatoires) (NON PAYANT)
- [ ] boutique de grades
- [ ] mise à jours
# screen(s)
<img width="984" height="625" alt="image" src="https://github.com/user-attachments/assets/9cb95b04-c17d-4c5d-998c-ad961e7f069d" />




