# Impostor

Prototyp przeglądarkowej gry imprezowej w klimacie dedukcji. Aplikacja składa się z prostego serwera HTTP (Node.js) oraz statycznego front-endu korzystającego z SSE do komunikacji w czasie rzeczywistym.

## Uruchomienie

1. Upewnij się, że masz zainstalowane środowisko **Node.js 18+**.
2. W katalogu projektu uruchom komendę:

   ```bash
   npm start
   ```

3. Wejdź w przeglądarce na adres [http://localhost:3000](http://localhost:3000).

## Zasady gry

- Gracze tworzą lub dołączają do lobby (publicznego albo prywatnego z kodem).
- Host rozpoczyna partię – wszyscy oprócz jednego gracza otrzymują to samo hasło.
- Kolejno, w wylosowanej kolejności, gracze wpisują skojarzenie z hasłem.
- Po zebraniu wskazówek następuje 120 sekund dyskusji z czatem.
- W fazie głosowania każdy wybiera podejrzanego albo pomija głos.
- Jeśli impostor zostanie wyeliminowany, dostaje ostatnią szansę na odgadnięcie hasła.
- Udana próba oznacza zwycięstwo impostora, w przeciwnym razie wygrywa załoga.
- Jeśli załoga wyrzuci niewinnego gracza, impostor wygrywa natychmiast.

## Struktura projektu

```
.
├── public
│   ├── index.html   # Widok główny i interfejs gry
│   ├── script.js    # Logika UI oraz komunikacja z serwerem (SSE + REST)
│   └── styles.css   # Warstwa prezentacji
├── server.js        # Logika serwera, lobby, rund oraz strumieni SSE
└── package.json     # Skrypt uruchomieniowy
```

## Możliwe rozszerzenia

- Trwałe przechowywanie lobby (np. baza danych) zamiast pamięci procesu.
- Konfigurowalne listy haseł oraz ustawienia czasu na etapie tworzenia lobby.
- Bardziej rozbudowany system punktacji i statystyk.
- Implementacja WebSocketów dla większej skalowalności.
