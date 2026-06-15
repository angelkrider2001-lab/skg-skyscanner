# SKG → Παντού (Browserless)

Εφαρμογή **χωρίς browser** και **χωρίς API key** που αναζητά φθηνές πτήσεις από Θεσσαλονίκη προς **οπουδήποτε**.

Καλεί απευθείας το εσωτερικό endpoint του Skyscanner:

```
POST https://www.skyscanner.net/g/radar/api/v2/web-unified-search
```

Με `legDestination: { "@type": "everywhere" }` — το ίδιο με το κουμπί «παντού» στο site.

## Γιατί όχι RapidAPI;

| RapidAPI | Browserless (αυτό) |
|----------|-------------------|
| Χρειάζεται subscription | Δωρεάν |
| 3rd party wrapper | Απευθείας Skyscanner |
| Μπορεί να κόβει (403) | HTTP στο skyscanner.net |

## Setup

```bash
cd browserless
npm install
npm start
```

Άνοιξε **http://localhost:3001**

Δεν χρειάζεται `.env` key — μόνο optional `PORT=3001`.

## Πώς δουλεύει

1. **Autosuggest** → βρίσκει entityId της Θεσσαλονίκης
2. **web-unified-search** → everywhere round-trip για κάθε περίοδο (Πέμ–Κυρ, Παρ–Δευ, Σάβ–Τρί)
3. Ταξινόμηση → top 10 φθηνότεροι προορισμοί

## Σημείωση

Το endpoint είναι εσωτερικό του Skyscanner (όχι επίσημο public API). Μπορεί να αλλάξει ή να μπλοκάρει requests στο μέλλον — για προσωπική χρήση.

Τρέχει στην **port 3001** (το scraping app είναι στο 3000).
