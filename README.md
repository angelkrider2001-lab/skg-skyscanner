# SKG Airline Scraper

Τοπική web εφαρμογή που κάνει **scraping** φθηνών πτήσεων από **Θεσσαλονίκη (SKG)** μέσω των 5 μεγαλύτερων εταιρειών:

| Εταιρεία | Μέθοδος |
|----------|---------|
| **Ryanair** | HTTP API (fare-finder) |
| **Aegean** | Playwright + network interception |
| **Sky Express** | Playwright + network interception |
| **Eurowings** | Playwright + network interception |
| **easyJet** | Playwright + network interception |

## Τι κάνει

Για τον επιλεγμένο μήνα, για **κάθε εβδομάδα**, αναζητά πτήσεις με 3 περιόδους:

| Pattern | Αναχώρηση → Επιστροφή |
|---------|------------------------|
| Πέμ · Παρ · Σάβ · Κυρ | Πέμπτη → Κυριακή |
| Παρ · Σάβ · Κυρ · Δευ | Παρασκευή → Δευτέρα |
| Σάβ · Κυρ · Δευ · Τρί | Σάββατο → Τρίτη |

Για κάθε περίοδο εμφανίζει τις **10 φθηνότερες** επιλογές από όλες τις εταιρείες.

## Εγκατάσταση

```bash
cd skyscanner
npm install
npx playwright install chromium
```

## Εκκίνηση

```bash
npm start
```

Άνοιξε **http://localhost:3000** και πάτα **«Έναρξη Scrape»**.

## Δομή

```
skyscanner/
├── server.js
├── lib/
│   ├── dates.js              # Λογική ημερομηνιών
│   ├── orchestrator.js       # Browser lifecycle + job runner
│   └── scrapers/
│       ├── base.js
│       ├── ryanair.js        # HTTP API
│       ├── aegean.js
│       ├── skyexpress.js
│       ├── eurowings.js
│       └── easyjet.js
├── data/routes-skg.json      # Προορισμοί ανά εταιρεία
└── public/                   # UI
```

## Σημειώσεις

- Διάρκεια: ~10–20 λεπτά ανά μήνα (πολλαπλά scrapes ανά εταιρεία/περίοδο).
- Αν μια εταιρεία αποτύχει, οι υπόλοιπες συνεχίζουν (partial results).
- Screenshots αποτυχιών αποθηκεύονται στο `logs/`.
- Το scraping μπορεί να παραβιάζει τους όρους χρήσης των ιστοσελίδων — μόνο για προσωπική τοπική χρήση.
