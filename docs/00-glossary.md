# Słownik pojęć domenowych (SCL-DCS)

Pierwszy plik do przeczytania przy każdym tasku DCS. Źródło: brief
SCL-DCS (SCMS-SCL-SA-0001-PL rev. A) i procedura SCMS-SCL-KQ-0001.

| Pojęcie | Znaczenie |
|---|---|
| **MDR / SMDR** | (Sea Clouds) Master Document Register — rejestr wszystkich dokumentów projektu wraz z ich statusami, rewizjami i datami. Dziś prowadzony w Excelu (`SCL_SMDR_v4.xlsx`); DCS ma go zastąpić. |
| **IDC** | Internal Discipline Check — wewnętrzna weryfikacja dokumentu przed wydaniem do klienta. Obieg równoległy: N recenzentów ocenia jednocześnie, etap kończy się, gdy wszyscy wystawili kod akceptacji. |
| **IFR** | Issued for Review — wydanie dokumentu do przeglądu zewnętrznego (klienta). Od IFR wzwyż obieg jest szeregowy: Checker → Approver → Document Controller. |
| **RETCOM** | Returned with Comments — status po otrzymaniu komentarzy klienta; kolejna rewizja jest w opracowaniu. |
| **IFC / IFI / IFB** | Issued for Construction / Information / As-Built — rewizje finalne dokumentu (do realizacji / do informacji / powykonawcza). Pliki rewizji finalnych są niemodyfikowalne. |
| **CPY** | Company / Client — klient (strona zamawiająca). Tor CPY to numeracja dokumentów i rewizji prowadzona przez klienta, równoległa do toru SCL. |
| **SCL** | Sea Clouds — kod originatora w numeracji dokumentów. Tor SCL to wewnętrzna, generowana przez system numeracja (`SC2601-SCL-RA-0012-EN`). |
| **CTR** | Cost–Time–Resource — kod aktywności, pod który rejestrowane są godziny w TES i do którego przypisany jest dokument w DCS. W bazie odpowiadają mu `public.sub_projects` (kolumna `code`). |
| **Transmittal** | Formalna paczka wysyłkowa dokumentów do klienta, z własnym numerem i rejestrem wysyłek. Tworzy ją Document Controller. |
| **Rewizja** | Kolejne wydanie dokumentu (A, B… dla IDC; 00, 01… dla IFR; 1, 2… dla finalnych). Ma własne pliki, obieg i kod akceptacji. Numer rewizji SCL jest walidowany, rewizja CPY ma dowolny format. |
| **Etap (step)** | Krok cyklu życia dokumentu: START → IDC → IFR → RETCOM → IFC/IFI/IFB. Dla każdego etapu prowadzone są daty Planned / Forecast / Actual. |
| **Originator (ORIG)** | Właściciel dokumentu: tworzy dokument i rewizje, dodaje pliki, wybiera recenzentów IDC, edytuje daty Forecast, odpowiada na komentarze. Nie może być Checkerem tej samej rewizji. |
| **Reviewer (REV)** | Recenzent IDC — wystawia kod akceptacji 1–4 i komentarze do przypisanej rewizji. |
| **Checker (CHK)** | Sprawdza dokument na ścieżce IFR i wyżej; przy wielu recenzentach wystawia końcowy kod akceptacji dokumentu. |
| **Approver (APP)** | Zatwierdza dokument — ostatni krok merytoryczny; odbiorca eskalacji opóźnień. |
| **Document Controller (DC)** | Nadaje i zwalnia numery (w tym CPY), prowadzi i eksportuje MDR, konfiguruje projekt, zarządza słownikami, zamyka obieg (zapisuje datę Actual) i tworzy transmittale. Jedyna rola zmieniająca numery. |
| **Kody akceptacji 1–4** | 1 = zaakceptowano bez komentarzy; 2 = zaakceptowano z komentarzami do wprowadzenia (wymagana kolejna rewizja); 3 = nie zaakceptowano (powrót do Originatora, komentarz obowiązkowy); 4 = nie recenzowano, przyjęto do informacji. |
| **Planned / Forecast / Actual** | Trzy daty każdego etapu: Planned — zobowiązanie wobec klienta (wylicza system, koryguje DC); Forecast — prognoza (edytuje Originator, wielokrotnie); Actual — fakt (zapisuje wyłącznie system przy zamknięciu etapu). |
| **Cykl 7/10/7** | Domyślny cykl review projektu w dniach kalendarzowych: IDC→IFR 7, IFR→RETCOM 10, RETCOM→IFC 7 (razem 24 dni). Atrybut MDR projektu, edytowalny; dziedziczony przez dokumenty. |
| **Void** | Unieważnienie dokumentu lub numeru. Numer Void nigdy nie wraca do puli — luki w numeracji nie są uzupełniane. Błędny dokument dostaje Void, a w jego miejsce tworzy się nowy. |
