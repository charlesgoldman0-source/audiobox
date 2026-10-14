#!/bin/bash
# Double-click this file on a Mac to update Audiobox to the latest version, then start it.
# Your settings are kept: the folders, the checklist and any Spotify sign-in live in files
# inside this folder that an update never touches.

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
cd "$(dirname "$0")" || exit 1

if curl -s -m 2 http://localhost:4848/api/status >/dev/null 2>&1; then
  echo "Audiobox is still running. Close its Terminal window first, then double-click this file again."
  read -r -p "Press Enter to close."
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "Git was not found. Install it with:  brew install git"
  read -r -p "Press Enter to close."
  exit 1
fi

echo "Fetching the latest Audiobox..."
if ! git pull --ff-only; then
  echo
  echo "The update could not be applied automatically. This usually means a file in this"
  echo "folder was edited by hand. Copy .audiobox-library.json and .audiobox-spotify.json"
  echo "somewhere safe, install Audiobox again from the README, and put those two files back."
  read -r -p "Press Enter to close."
  exit 1
fi

echo "Installing anything new..."
npm install || { read -r -p "Install failed. Press Enter to close."; exit 1; }

echo "Updated. Starting Audiobox..."
exec "./Start Audiobox.command"
