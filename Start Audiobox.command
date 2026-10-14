#!/bin/bash
# Double-click this file on a Mac to start Audiobox and open it in your browser.
# Close the Terminal window (or press Ctrl+C in it) to stop the app.

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js was not found. Install it with:  brew install node"
  read -r -p "Press Enter to close."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "First run: installing the app's dependencies."
  npm install || { read -r -p "Install failed. Press Enter to close."; exit 1; }
fi

( sleep 2; open "http://localhost:4848" ) &
npm start
