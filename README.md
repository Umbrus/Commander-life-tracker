# CommandSync

A mobile-first companion for Magic: The Gathering Commander games. Track life totals, turns, commander damage, and match results with friends.

## Features

- Host or join synchronized Commander pods, or play pass-and-play at one table.
- Track decks, card art, match history, and performance.
- Look up card details with Scryfall and use the built-in dice and coin roller.
- Choose full-app set themes and customize player card frames.

## Run locally

Serve the repository over HTTP or HTTPS and open `index.html`. There is no build step. Synchronized pods and account backup use Firebase; card lookups use Scryfall.

## Firebase setup

Enable **Anonymous** authentication in Firebase Authentication. Then deploy `database.rules.json` to Realtime Database. With Firebase CLI installed, run:

```sh
firebase deploy --only database
```
