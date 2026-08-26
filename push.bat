@echo off
echo [1/3] Adding changes...
git add .

echo [2/3] Committing changes...
set /p commitMsg="Enter commit message (or press Enter for default): "
if "%commitMsg%"=="" set commitMsg=Auto-update project files

git commit -m "%commitMsg%"

echo [3/3] Pushing to GitHub...
git push origin main

echo Done! Changes uploaded successfully.
pause