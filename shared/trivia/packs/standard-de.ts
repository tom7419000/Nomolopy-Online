/**
 * Mitgeliefertes deutsches Fragenpaket.
 *
 * Bewusst eine TypeScript-Konstante und kein nachgeladenes JSON – analog zu
 * `BUILT_IN_EDITIONS`. Nur so steht der Bestand im lokalen Offline-Modus
 * ohne jede Serveranbindung zur Verfügung.
 *
 * Aufbau: sechs Kategorien × fünf Stufen × zehn Fragen = 300. Jedes Fach
 * braucht mindestens vier (siehe `MIN_PER_BUCKET`), weil Trivial Pursuit
 * seine falschen Antwortmöglichkeiten aus den übrigen Antworten desselben
 * Fachs zieht. `tests/trivia.test.ts` prüft die Vollständigkeit.
 *
 * Stufen: 1 = Allgemeinwissen, 3 = solide Schulbildung, 5 = Kennerfrage.
 */

import type { TriviaCategory, TriviaLevel, TriviaPack, TriviaQuestion } from '../types';

/** Kompakte Schreibweise: [Stufe, Frage, Antwort, ...Alternativschreibweisen] */
type Row = [TriviaLevel, string, string, ...string[]];

function build(category: TriviaCategory, rows: Row[]): TriviaQuestion[] {
  return rows.map(([level, prompt, answer, ...accept], i) => ({
    id: `${category}-${String(i + 1).padStart(2, '0')}`,
    category,
    level,
    prompt,
    answer,
    ...(accept.length ? { accept } : {}),
  }));
}

// ---------------------------------------------------------------------------
// 🌍 Geografie
// ---------------------------------------------------------------------------

const GEOGRAFIE = build('geografie', [
  [1, 'Wie heißt die Hauptstadt von Frankreich?', 'Paris'],
  [1, 'Wie heißt die Hauptstadt von Italien?', 'Rom'],
  [1, 'Welcher Kontinent liegt südlich von Europa?', 'Afrika'],
  [1, 'Welches deutsche Bundesland ist flächenmäßig das größte?', 'Bayern'],
  [1, 'In welchem Land steht der Eiffelturm?', 'Frankreich'],
  [1, 'An welches Meer grenzt Deutschland im Nordwesten?', 'Die Nordsee', 'Nordsee'],
  [1, 'Wie heißt die Hauptstadt von Spanien?', 'Madrid'],
  [1, 'Welcher große Fluss fließt durch Köln?', 'Der Rhein', 'Rhein'],
  [1, 'Wie heißt die Hauptstadt von Österreich?', 'Wien'],
  [1, 'Welches europäische Land hat die Form eines Stiefels?', 'Italien'],

  [2, 'Wie heißt die Hauptstadt von Kanada?', 'Ottawa'],
  [2, 'Welcher Fluss mündet bei Cuxhaven in die Nordsee?', 'Die Elbe', 'Elbe'],
  [2, 'Wie heißt die Hauptstadt von Portugal?', 'Lissabon'],
  [2, 'Welcher Ozean ist der größte der Erde?', 'Der Pazifik', 'Pazifik', 'Pazifischer Ozean'],
  [2, 'Auf welchem Kontinent liegt die Sahara?', 'Afrika'],
  [2, 'Wie heißt die Hauptstadt von Norwegen?', 'Oslo'],
  [2, 'Welches Land ist Portugals einziger Nachbar zu Lande?', 'Spanien'],
  [2, 'Wie heißt die Bundesstadt der Schweiz, in der die Regierung sitzt?', 'Bern'],
  [2, 'Wie heißt der höchste Berg Deutschlands?', 'Die Zugspitze', 'Zugspitze'],
  [2, 'In welchem Land liegt die Inkastadt Machu Picchu?', 'Peru'],

  [3, 'Wie heißt die Hauptstadt von Australien?', 'Canberra'],
  [3, 'Welche Meerenge trennt Europa von Afrika?', 'Die Straße von Gibraltar', 'Straße von Gibraltar', 'Gibraltar'],
  [3, 'Wie heißt die Hauptstadt von Neuseeland?', 'Wellington'],
  [3, 'Welcher See ist der tiefste der Erde?', 'Der Baikalsee', 'Baikalsee', 'Baikal'],
  [3, 'Wie heißt die Hauptstadt der Türkei?', 'Ankara'],
  [3, 'Welches Land umschließt Lesotho vollständig?', 'Südafrika'],
  [3, 'Welcher Fluss fließt durch Kairo?', 'Der Nil', 'Nil'],
  [3, 'Wie heißt die Hauptstadt von Vietnam?', 'Hanoi'],
  [3, 'Welches ist der flächenmäßig kleinste Staat der Erde?', 'Die Vatikanstadt', 'Vatikanstadt', 'Vatikan'],
  [3, 'In welches Meer mündet die Donau?', 'Das Schwarze Meer', 'Schwarzes Meer'],

  [4, 'Wie heißt die Hauptstadt von Bhutan?', 'Thimphu'],
  [4, 'Welches Land hat die längste Küstenlinie der Erde?', 'Kanada'],
  [4, 'Wie heißt die Hauptstadt von Uruguay?', 'Montevideo'],
  [4, 'Wie heißt die größte Insel der Erde?', 'Grönland'],
  [4, 'Welcher Fluss führt das meiste Wasser aller Flüsse der Erde?', 'Der Amazonas', 'Amazonas'],
  [4, 'In welchem Land liegt die Atacama-Wüste?', 'Chile'],
  [4, 'Wie heißt die Hauptstadt von Marokko?', 'Rabat'],
  [4, 'Welche deutsche Stadt liegt am Zusammenfluss von Rhein und Mosel?', 'Koblenz'],
  [4, 'Wie heißt der höchste Berg Afrikas?', 'Der Kilimandscharo', 'Kilimandscharo', 'Kilimanjaro'],
  [4, 'Welches nordeuropäische Land wird „Land der tausend Seen" genannt?', 'Finnland'],

  [5, 'Wie heißt die Hauptstadt von Kirgisistan?', 'Bischkek'],
  [5, 'Wie heißt die tiefste bekannte Stelle der Ozeane?', 'Der Marianengraben', 'Marianengraben'],
  [5, 'Welche Republik ist neben dem Vatikan vollständig von Italien umschlossen?', 'San Marino'],
  [5, 'Wie heißt die Hauptstadt von Suriname?', 'Paramaribo'],
  [5, 'Welcher Fluss bildet über weite Strecken die Grenze zwischen den USA und Mexiko?', 'Der Rio Grande', 'Rio Grande'],
  [5, 'Wie heißt die seit 2006 offizielle Hauptstadt von Myanmar?', 'Naypyidaw', 'Naypyitaw'],
  [5, 'Welches Binnengewässer in Zentralasien schrumpfte durch Bewässerung dramatisch?', 'Der Aralsee', 'Aralsee'],
  [5, 'In welchem Land liegt die historische Stadt Timbuktu?', 'Mali'],
  [5, 'Wie heißt der längste Fluss Europas?', 'Die Wolga', 'Wolga'],
  [5, 'Welche Stadt ist Regierungssitz Boliviens?', 'La Paz'],
]);

// ---------------------------------------------------------------------------
// 🎬 Unterhaltung
// ---------------------------------------------------------------------------

const UNTERHALTUNG = build('unterhaltung', [
  [1, 'Wie heißt der Zauberlehrling mit der Blitznarbe aus den Romanen von J. K. Rowling?', 'Harry Potter'],
  [1, 'Welche Hautfarbe haben die Figuren in „Die Simpsons"?', 'Gelb'],
  [1, 'Wie heißt die Maus, die das Wahrzeichen von Disney ist?', 'Micky Maus', 'Mickey Mouse', 'Micky Mouse'],
  [1, 'In welcher Stadt lebt der Comic-Held Batman?', 'Gotham City', 'Gotham'],
  [1, 'Wie heißt der grüne Oger aus dem gleichnamigen Animationsfilm von 2001?', 'Shrek'],
  [1, 'Welches Instrument spielte Elvis Presley auf der Bühne meistens?', 'Die Gitarre', 'Gitarre'],
  [1, 'Wie heißt der Seemann aus dem Zeichentrick, der durch Spinat stark wird?', 'Popeye'],
  [1, 'Welche Band sang „Yellow Submarine"?', 'The Beatles', 'Beatles', 'Die Beatles'],
  [1, 'Wie heißt der Bär aus dem „Dschungelbuch"?', 'Balu', 'Baloo'],
  [1, 'In welchem Film sagt eine Figur „Ich bin dein Vater"?', 'Star Wars', 'Krieg der Sterne'],

  [2, 'Wie heißt der Regisseur von „Der weiße Hai" und „E.T."?', 'Steven Spielberg', 'Spielberg'],
  [2, 'Welche Sängerin wird „Queen of Pop" genannt?', 'Madonna'],
  [2, 'Wie heißt das Raumschiff in der Serie „Raumschiff Enterprise"?', 'Die Enterprise', 'Enterprise'],
  [2, 'Welcher Schauspieler spielte in „Titanic" die Hauptrolle Jack?', 'Leonardo DiCaprio', 'DiCaprio'],
  [2, 'Wie heißt der Detektiv, den Arthur Conan Doyle erfand?', 'Sherlock Holmes'],
  [2, 'Welche Band veröffentlichte das Album „The Dark Side of the Moon"?', 'Pink Floyd'],
  [2, 'Wie heißt der Held der Filmreihe, der eine Peitsche und einen Hut trägt?', 'Indiana Jones'],
  [2, 'In welcher Fernsehserie leben Ross, Rachel, Monica, Chandler, Joey und Phoebe?', 'Friends'],
  [2, 'Wie heißt der Komponist der Filmmusik zu „Star Wars"?', 'John Williams'],
  [2, 'Welches Duo besteht aus den Puppen Ernie und Bert?', 'Die Sesamstraße', 'Sesamstraße'],

  [3, 'Wie heißt der Regisseur von „Pulp Fiction"?', 'Quentin Tarantino', 'Tarantino'],
  [3, 'Welcher Film gewann 1994 den Oscar als bester Film mit Tom Hanks in der Hauptrolle?', 'Forrest Gump'],
  [3, 'Wie heißt die Hauptfigur in der Serie „Breaking Bad"?', 'Walter White'],
  [3, 'Welche schwedische Popgruppe gewann 1974 den Eurovision Song Contest mit „Waterloo"?', 'ABBA'],
  [3, 'Wie heißt der Roman von Michael Ende über ein Mädchen und graue Herren?', 'Momo'],
  [3, 'Welcher Schauspieler verkörperte James Bond zuerst im Kino?', 'Sean Connery', 'Connery'],
  [3, 'Wie heißt das fiktive Land in „Der Herr der Ringe", in dem die Hobbits leben?', 'Das Auenland', 'Auenland'],
  [3, 'Welche Fernsehserie spielt im Fantasy-Reich Westeros?', 'Game of Thrones'],
  [3, 'Wie heißt der Regisseur von „Inception" und „Interstellar"?', 'Christopher Nolan', 'Nolan'],
  [3, 'Welches Instrument spielte Louis Armstrong?', 'Die Trompete', 'Trompete'],

  [4, 'Wie heißt der Animationsfilm von Hayao Miyazaki über ein Mädchen im Badehaus der Geister?', 'Chihiros Reise ins Zauberland', 'Spirited Away'],
  [4, 'Welcher Regisseur drehte „Metropolis" (1927)?', 'Fritz Lang', 'Lang'],
  [4, 'Wie heißt der erste abendfüllende Zeichentrickfilm von Disney?', 'Schneewittchen und die sieben Zwerge', 'Schneewittchen'],
  [4, 'Welche Band nahm das Album „OK Computer" auf?', 'Radiohead'],
  [4, 'Wie heißt Hitchcocks Film „Das Fenster zum Hof" im englischen Original?', 'Rear Window'],
  [4, 'Welcher Komponist schrieb die Oper „Der Ring des Nibelungen"?', 'Richard Wagner', 'Wagner'],
  [4, 'Wie heißt die Schriftstellerin, die „Pippi Langstrumpf" erfand?', 'Astrid Lindgren', 'Lindgren'],
  [4, 'Welcher Film gewann 2020 als erster nicht-englischsprachiger Film den Oscar als bester Film?', 'Parasite'],
  [4, 'Wie heißt der Dirigent, der die Berliner Philharmoniker von 1955 bis 1989 leitete?', 'Herbert von Karajan', 'Karajan'],
  [4, 'Welches Musical spielt in der Pariser Oper und handelt von einem maskierten Mann?', 'Das Phantom der Oper', 'Phantom der Oper'],

  [5, 'Wie heißt der Regisseur des Films „Stalker" (1979)?', 'Andrei Tarkowski', 'Tarkowski', 'Tarkovsky'],
  [5, 'Welcher Schauspieler spielte die Titelrolle in Fellinis „8½"?', 'Marcello Mastroianni', 'Mastroianni'],
  [5, 'Wie heißt die Filmmusik-Komponistin, die 2020 für „Joker" einen Oscar gewann?', 'Hildur Guðnadóttir', 'Hildur Gudnadottir'],
  [5, 'Welches Album der Beach Boys gilt als Meilenstein der Popproduktion von 1966?', 'Pet Sounds'],
  [5, 'Wie heißt der Regisseur von „Das Leben der Anderen"?', 'Florian Henckel von Donnersmarck', 'Henckel von Donnersmarck'],
  [5, 'Welcher Jazzmusiker nahm das Album „Kind of Blue" auf?', 'Miles Davis'],
  [5, 'Wie heißt der Roman von Thomas Mann über eine Lungenheilanstalt in den Alpen?', 'Der Zauberberg', 'Zauberberg'],
  [5, 'Welche Regisseurin gewann 2010 als erste Frau den Oscar für die beste Regie?', 'Kathryn Bigelow', 'Bigelow'],
  [5, 'Wie heißt das Theaterstück von Samuel Beckett, in dem zwei Männer warten?', 'Warten auf Godot', 'Godot'],
  [5, 'Welcher Musiker veröffentlichte 1971 das Album „Hunky Dory"?', 'David Bowie', 'Bowie'],
]);


// ---------------------------------------------------------------------------
// 🏛 Geschichte
// ---------------------------------------------------------------------------

const GESCHICHTE = build('geschichte', [
  [1, 'In welchem Jahr fiel die Berliner Mauer?', '1989'],
  [1, 'Wer war der erste Bundeskanzler der Bundesrepublik Deutschland?', 'Konrad Adenauer', 'Adenauer'],
  [1, 'Wer entdeckte 1492 Amerika für die Europäer?', 'Christoph Kolumbus', 'Kolumbus', 'Columbus'],
  [1, 'Wie lautete der Herrschertitel im alten Ägypten?', 'Pharao'],
  [1, 'In welchem Jahr endete der Zweite Weltkrieg in Europa?', '1945'],
  [1, 'Welches Bauwerk teilte Berlin von 1961 bis 1989?', 'Die Berliner Mauer', 'Berliner Mauer'],
  [1, 'Wer war die erste Bundeskanzlerin Deutschlands?', 'Angela Merkel', 'Merkel'],
  [1, 'Aus welchem Material bestanden die Werkzeuge der Steinzeit hauptsächlich?', 'Stein'],
  [1, 'Welches antike Volk erbaute das Kolosseum?', 'Die Römer', 'Römer'],
  [1, 'Wie hieß das Schiff, das 1912 nach einer Eisbergkollision sank?', 'Die Titanic', 'Titanic'],

  [2, 'Wer erfand um 1450 den Buchdruck mit beweglichen Lettern?', 'Johannes Gutenberg', 'Gutenberg'],
  [2, 'In welchem Jahr begann der Erste Weltkrieg?', '1914'],
  [2, 'Wie hieß der erste Mensch auf dem Mond?', 'Neil Armstrong', 'Armstrong'],
  [2, 'Welcher französische Kaiser wurde 1815 bei Waterloo endgültig besiegt?', 'Napoleon Bonaparte', 'Napoleon'],
  [2, 'In welchem Jahr wurde die Bundesrepublik Deutschland gegründet?', '1949'],
  [2, 'Wie heißt der Grenzwall, den die Römer in Britannien errichteten?', 'Der Hadrianswall', 'Hadrianswall'],
  [2, 'Welcher Reformator veröffentlichte 1517 seine Thesen?', 'Martin Luther', 'Luther'],
  [2, 'In welcher Stadt wurde 1919 die deutsche Reichsverfassung beschlossen?', 'Weimar'],
  [2, 'Welches Volk erbaute die Pyramiden von Gizeh?', 'Die Ägypter', 'Ägypter'],
  [2, 'In welchem Jahrhundert fand die Französische Revolution statt?', 'Im 18. Jahrhundert', '18. Jahrhundert', '18'],

  [3, 'In welchem Jahr stürmten die Pariser die Bastille?', '1789'],
  [3, 'Wie hieß der erste römische Kaiser?', 'Augustus'],
  [3, 'Welcher Vertrag beendete 1919 formal den Ersten Weltkrieg?', 'Der Versailler Vertrag', 'Versailler Vertrag', 'Vertrag von Versailles'],
  [3, 'Wie hieß der Städtebund norddeutscher Kaufleute im Mittelalter?', 'Die Hanse', 'Hanse'],
  [3, 'In welchem Jahr wurde die Sowjetunion aufgelöst?', '1991'],
  [3, 'Wer war die letzte Königin des antiken Ägypten?', 'Kleopatra', 'Cleopatra'],
  [3, 'Welcher Krieg dauerte von 1618 bis 1648?', 'Der Dreißigjährige Krieg', 'Dreißigjähriger Krieg'],
  [3, 'Wie hieß der Anführer der Hunnen im 5. Jahrhundert?', 'Attila'],
  [3, 'In welchem Jahr eroberten die Osmanen Konstantinopel?', '1453'],
  [3, 'Welches Dokument beschlossen die dreizehn Kolonien 1776?', 'Die Unabhängigkeitserklärung', 'Unabhängigkeitserklärung'],

  [4, 'Wie heißt der Friedensschluss, der 1648 den Dreißigjährigen Krieg beendete?', 'Der Westfälische Friede', 'Westfälischer Friede', 'Westfälischer Frieden'],
  [4, 'Welcher preußische König wird „der Große" genannt?', 'Friedrich der Große', 'Friedrich II.', 'Friedrich II'],
  [4, 'In welchem Jahr wurde Karl der Große zum Kaiser gekrönt?', '800'],
  [4, 'Welche Dynastie einte China erstmals zu einem Kaiserreich?', 'Die Qin-Dynastie', 'Qin-Dynastie', 'Qin'],
  [4, 'Wessen Expedition umsegelte als erste die Erde?', 'Ferdinand Magellan', 'Magellan'],
  [4, 'In welchem Jahr fand die Schlacht bei Hastings statt?', '1066'],
  [4, 'Wer war 1871 der erste Reichskanzler des Deutschen Reiches?', 'Otto von Bismarck', 'Bismarck'],
  [4, 'Welches Reich regierte Süleyman der Prächtige?', 'Das Osmanische Reich', 'Osmanisches Reich'],
  [4, 'In welchem Jahr wurde die Magna Carta besiegelt?', '1215'],
  [4, 'In welchem Jahr kam es zum Volksaufstand in der DDR?', '1953'],

  [5, 'Welcher byzantinische Kaiser ließ die Hagia Sophia errichten?', 'Justinian I.', 'Justinian'],
  [5, 'In welchem Jahr endete das Weströmische Reich?', '476'],
  [5, 'Welcher Vertrag teilte 1494 die Neue Welt zwischen Spanien und Portugal auf?', 'Der Vertrag von Tordesillas', 'Vertrag von Tordesillas', 'Tordesillas'],
  [5, 'Welcher Herrscher begründete das größte zusammenhängende Landreich der Geschichte?', 'Dschingis Khan', 'Genghis Khan'],
  [5, 'In welchem Jahr endete der Wiener Kongress?', '1815'],
  [5, 'Welche ägyptische Herrscherin ließ sich als Mann darstellen?', 'Hatschepsut'],
  [5, 'Welches Konzil legte 325 das christliche Glaubensbekenntnis fest?', 'Das Konzil von Nicäa', 'Konzil von Nicäa', 'Nicäa'],
  [5, 'Wie hieß der Anführer des großen Sklavenaufstands gegen Rom ab 73 v. Chr.?', 'Spartacus', 'Spartakus'],
  [5, 'In welchem Jahr entstand die Doppelmonarchie Österreich-Ungarn?', '1867'],
  [5, 'Welche altägyptische Schrift entzifferte Jean-François Champollion?', 'Die Hieroglyphen', 'Hieroglyphen'],
]);

// ---------------------------------------------------------------------------
// 🎨 Kunst & Literatur
// ---------------------------------------------------------------------------

const KUNST = build('kunst', [
  [1, 'Wer malte die „Mona Lisa"?', 'Leonardo da Vinci', 'da Vinci', 'Leonardo'],
  [1, 'Wie heißt Goethes Drama über einen Gelehrten und den Teufel?', 'Faust'],
  [1, 'Welche Farbe entsteht beim Mischen von Blau und Gelb?', 'Grün'],
  [1, 'Wer schrieb „Romeo und Julia"?', 'William Shakespeare', 'Shakespeare'],
  [1, 'Wie heißt das Märchen vom Mädchen mit der roten Kappe?', 'Rotkäppchen'],
  [1, 'In welchem Pariser Museum hängt die Mona Lisa?', 'Im Louvre', 'Louvre'],
  [1, 'Wer sammelte die Märchen „Hänsel und Gretel" und „Aschenputtel"?', 'Die Brüder Grimm', 'Brüder Grimm', 'Gebrüder Grimm'],
  [1, 'Welches Tasteninstrument hat schwarze und weiße Tasten?', 'Das Klavier', 'Klavier'],
  [1, 'Welcher Maler schnitt sich ein Ohrläppchen ab?', 'Vincent van Gogh', 'van Gogh'],
  [1, 'Wie heißt die Kunstform, bei der Figuren aus Stein gehauen werden?', 'Die Bildhauerei', 'Bildhauerei', 'Skulptur'],

  [2, 'Wer malte „Die Sternennacht"?', 'Vincent van Gogh', 'van Gogh'],
  [2, 'Wie heißt Herman Melvilles Roman über einen weißen Wal?', 'Moby Dick'],
  [2, 'Welcher Künstler schuf die Marmorstatue „David" in Florenz?', 'Michelangelo'],
  [2, 'Wer schrieb „Der Steppenwolf"?', 'Hermann Hesse', 'Hesse'],
  [2, 'Wie heißt die Kapelle im Vatikan mit Michelangelos Deckenfresken?', 'Die Sixtinische Kapelle', 'Sixtinische Kapelle'],
  [2, 'Welcher Dichter schrieb „Wilhelm Tell" und „Die Bürgschaft"?', 'Friedrich Schiller', 'Schiller'],
  [2, 'Wer malte „Der Schrei"?', 'Edvard Munch', 'Munch'],
  [2, 'Wie heißt der Roman von Cervantes über einen Ritter und Windmühlen?', 'Don Quijote', 'Don Quichotte'],
  [2, 'Welche Kunstrichtung begründeten Pablo Picasso und Georges Braque?', 'Der Kubismus', 'Kubismus'],
  [2, 'Wer schrieb die Erzählung „Die Verwandlung"?', 'Franz Kafka', 'Kafka'],

  [3, 'Wer malte „Das Abendmahl" in Mailand?', 'Leonardo da Vinci', 'da Vinci', 'Leonardo'],
  [3, 'Welcher Architekt entwarf die Sagrada Família?', 'Antoni Gaudí', 'Gaudi'],
  [3, 'Wer schrieb „Die Blechtrommel"?', 'Günter Grass', 'Grass'],
  [3, 'Wie heißt die 1919 in Weimar gegründete Kunstschule?', 'Das Bauhaus', 'Bauhaus'],
  [3, 'Welcher Maler ist für seine Seerosen-Bilder berühmt?', 'Claude Monet', 'Monet'],
  [3, 'Wer schrieb den Roman „Der Prozess"?', 'Franz Kafka', 'Kafka'],
  [3, 'Wie heißt Salvador Dalís Gemälde mit den zerfließenden Uhren?', 'Die Beständigkeit der Erinnerung', 'Beständigkeit der Erinnerung'],
  [3, 'Welcher Komponist schrieb die Oper „Die Zauberflöte"?', 'Wolfgang Amadeus Mozart', 'Mozart'],
  [3, 'Wer schrieb den Roman „Effi Briest"?', 'Theodor Fontane', 'Fontane'],
  [3, 'Wie heißt Dostojewskis Roman über den Studenten Raskolnikow?', 'Schuld und Sühne', 'Verbrechen und Strafe'],

  [4, 'Wer malte „Die Nachtwache"?', 'Rembrandt'],
  [4, 'Wie heißt Marcel Prousts siebenbändiger Romanzyklus?', 'Auf der Suche nach der verlorenen Zeit'],
  [4, 'Welcher Bildhauer schuf „Der Denker"?', 'Auguste Rodin', 'Rodin'],
  [4, 'Wer schrieb „Hundert Jahre Einsamkeit"?', 'Gabriel García Márquez', 'García Márquez', 'Marquez'],
  [4, 'Wie hieß die Künstlergruppe um Wassily Kandinsky und Franz Marc?', 'Der Blaue Reiter', 'Blauer Reiter'],
  [4, 'Welcher spanische Hofmaler schuf „Las Meninas"?', 'Diego Velázquez', 'Velazquez'],
  [4, 'Wer schrieb den unvollendeten Roman „Der Mann ohne Eigenschaften"?', 'Robert Musil', 'Musil'],
  [4, 'Welche mexikanische Malerin schuf zahlreiche Selbstbildnisse?', 'Frida Kahlo', 'Kahlo'],
  [4, 'Wie heißt Charles Baudelaires berühmtester Gedichtband?', 'Die Blumen des Bösen', 'Les Fleurs du Mal'],
  [4, 'Welcher Architekt prägte den Grundsatz „form follows function"?', 'Louis Sullivan', 'Sullivan'],

  [5, 'Wer malte den Isenheimer Altar?', 'Matthias Grünewald', 'Grünewald'],
  [5, 'Welcher Roman von James Joyce spielt an einem einzigen Tag in Dublin?', 'Ulysses'],
  [5, 'Welcher Komponist schrieb „Das Wohltemperierte Klavier"?', 'Johann Sebastian Bach', 'Bach'],
  [5, 'Wer verfasste das Versepos „Die Göttliche Komödie"?', 'Dante Alighieri', 'Dante'],
  [5, 'Welche Malerin gehörte zur Künstlerkolonie Worpswede?', 'Paula Modersohn-Becker', 'Modersohn-Becker'],
  [5, 'Wie heißt die japanische Gedichtform aus drei Zeilen?', 'Das Haiku', 'Haiku'],
  [5, 'Welcher Künstler stellte 1917 das Werk „Fountain" aus?', 'Marcel Duchamp', 'Duchamp'],
  [5, 'Welcher Maler der Frührenaissance schuf „Die Geburt der Venus"?', 'Sandro Botticelli', 'Botticelli'],
  [5, 'In welchem Versmaß sind Homers Epen verfasst?', 'Im Hexameter', 'Hexameter'],
  [5, 'Wer schrieb den Roman „Der Zauberberg"?', 'Thomas Mann'],
]);

// ---------------------------------------------------------------------------
// 🔬 Wissenschaft & Natur
// ---------------------------------------------------------------------------

const WISSENSCHAFT = build('wissenschaft', [
  [1, 'Wie viele Beine hat eine Spinne?', 'Acht', '8'],
  [1, 'Welches Gas brauchen Menschen zum Atmen?', 'Sauerstoff'],
  [1, 'Welcher Planet ist der Sonne am nächsten?', 'Merkur'],
  [1, 'Welches ist das größte an Land lebende Tier?', 'Der Elefant', 'Elefant'],
  [1, 'Bei wie viel Grad Celsius gefriert Wasser?', '0'],
  [1, 'Wie viele Zähne hat ein erwachsener Mensch normalerweise?', '32'],
  [1, 'Welches Organ pumpt das Blut durch den Körper?', 'Das Herz', 'Herz'],
  [1, 'Wie heißt der natürliche Begleiter der Erde am Himmel?', 'Der Mond', 'Mond'],
  [1, 'Bei wie viel Grad Celsius siedet Wasser auf Meereshöhe?', '100'],
  [1, 'Welche Jahreszeit folgt auf den Sommer?', 'Der Herbst', 'Herbst'],

  [2, 'Wie lautet das chemische Symbol für Gold?', 'Au'],
  [2, 'Welcher Planet wird „der rote Planet" genannt?', 'Der Mars', 'Mars'],
  [2, 'Wie heißt der Vorgang, mit dem Pflanzen Licht in Energie umwandeln?', 'Die Photosynthese', 'Photosynthese', 'Fotosynthese'],
  [2, 'Wie viele Knochen hat ein erwachsener Mensch etwa?', '206'],
  [2, 'Welches Element ist im Universum am häufigsten?', 'Wasserstoff'],
  [2, 'Welches ist das größte Organ des menschlichen Körpers?', 'Die Haut', 'Haut'],
  [2, 'Welcher Physiker formulierte die Relativitätstheorie?', 'Albert Einstein', 'Einstein'],
  [2, 'Wie heißt die Einheit der elektrischen Spannung?', 'Volt'],
  [2, 'Welches Tier hat den längsten Hals?', 'Die Giraffe', 'Giraffe'],
  [2, 'Woraus besteht Wasser chemisch?', 'Aus Wasserstoff und Sauerstoff', 'Wasserstoff und Sauerstoff'],

  [3, 'Wie lautet das chemische Symbol für Eisen?', 'Fe'],
  [3, 'Wie heißt die Kraft, die Körper zur Erde hin zieht?', 'Die Schwerkraft', 'Schwerkraft', 'Gravitation'],
  [3, 'Welcher Naturforscher begründete die Evolutionstheorie?', 'Charles Darwin', 'Darwin'],
  [3, 'Wie viele Chromosomen hat eine menschliche Körperzelle?', '46'],
  [3, 'Welches Teilchen im Atomkern ist elektrisch neutral?', 'Das Neutron', 'Neutron'],
  [3, 'Welcher Planet unseres Sonnensystems ist der größte?', 'Der Jupiter', 'Jupiter'],
  [3, 'Wie heißt die Wissenschaft von den Erdbeben?', 'Die Seismologie', 'Seismologie'],
  [3, 'Welches Metall ist bei Zimmertemperatur flüssig?', 'Quecksilber'],
  [3, 'Wie heißt die SI-Einheit der Kraft?', 'Newton'],
  [3, 'Wie heißt der Blutfarbstoff, der Sauerstoff transportiert?', 'Hämoglobin'],

  [4, 'Welcher Physiker entdeckte 1895 die Röntgenstrahlen?', 'Wilhelm Conrad Röntgen', 'Röntgen'],
  [4, 'Wie heißt die Zahl für das Verhältnis von Kreisumfang zu Durchmesser?', 'Pi'],
  [4, 'Welches Element trägt die Ordnungszahl 1?', 'Wasserstoff'],
  [4, 'Wie heißt der vierte Aggregatzustand neben fest, flüssig und gasförmig?', 'Das Plasma', 'Plasma'],
  [4, 'Welche Wissenschaftlerin erhielt Nobelpreise in Physik und in Chemie?', 'Marie Curie', 'Curie'],
  [4, 'Wie heißt der Vorgang, bei dem Atomkerne verschmelzen?', 'Die Kernfusion', 'Kernfusion'],
  [4, 'Welcher Saturnmond besitzt eine dichte Atmosphäre?', 'Titan'],
  [4, 'Wie heißt das Modell vom heißen dichten Anfangszustand des Universums?', 'Der Urknall', 'Urknall', 'Big Bang'],
  [4, 'Welches Vitamin bildet die Haut unter Sonnenlicht?', 'Vitamin D'],
  [4, 'Wie heißt der Zellbestandteil, in dem die Energiegewinnung stattfindet?', 'Das Mitochondrium', 'Mitochondrium', 'Mitochondrien'],

  [5, 'Wie heißt das Prinzip, nach dem Ort und Impuls nicht gleichzeitig exakt bestimmbar sind?', 'Die Unschärferelation', 'Unschärferelation', 'Heisenbergsche Unschärferelation'],
  [5, 'Welcher Logiker bewies die Unvollständigkeitssätze?', 'Kurt Gödel', 'Gödel'],
  [5, 'Welches Element trägt das chemische Symbol W?', 'Wolfram'],
  [5, 'Wie heißt die Grenze, hinter der nichts einem Schwarzen Loch entkommt?', 'Der Ereignishorizont', 'Ereignishorizont'],
  [5, 'Welcher Chemiker ordnete die Elemente 1869 im Periodensystem?', 'Dmitri Mendelejew', 'Mendelejew', 'Mendelejev'],
  [5, 'Wie heißt die Verschiebung des Lichts sich entfernender Galaxien?', 'Die Rotverschiebung', 'Rotverschiebung'],
  [5, 'Welches Elementarteilchen wurde 2012 am CERN nachgewiesen?', 'Das Higgs-Boson', 'Higgs-Boson', 'Higgs'],
  [5, 'Wie heißt die Zahlenfolge, in der jede Zahl die Summe der beiden vorhergehenden ist?', 'Die Fibonacci-Folge', 'Fibonacci-Folge', 'Fibonacci'],
  [5, 'Welcher Zoologe prägte den Begriff „Ökologie"?', 'Ernst Haeckel', 'Haeckel'],
  [5, 'Wie heißt das Enzym, das DNA-Stränge verdoppelt?', 'Die DNA-Polymerase', 'DNA-Polymerase', 'Polymerase'],
]);

// ---------------------------------------------------------------------------
// ⚽ Sport & Freizeit
// ---------------------------------------------------------------------------

const SPORT = build('sport', [
  [1, 'Wie viele Spieler einer Fußballmannschaft stehen auf dem Feld?', 'Elf', '11'],
  [1, 'In welcher Sportart gibt es einen Slam Dunk?', 'Basketball'],
  [1, 'In welchem Abstand finden die Olympischen Sommerspiele statt?', 'Alle vier Jahre', 'Vier Jahre', '4 Jahre'],
  [1, 'Welche Farbe hat das Trikot des Gesamtführenden bei der Tour de France?', 'Gelb'],
  [1, 'Wie viele Ringe zeigt das olympische Symbol?', 'Fünf', '5'],
  [1, 'In welcher Sportart schlägt man einen Federball übers Netz?', 'Badminton'],
  [1, 'Wie viele Felder hat ein Schachbrett?', '64'],
  [1, 'Welche Sportart wird in Wimbledon gespielt?', 'Tennis'],
  [1, 'Wie viele Löcher hat eine vollständige Golfrunde?', '18'],
  [1, 'In welcher Sportart gibt es einen Strike und einen Spare?', 'Bowling'],

  [2, 'In welcher Stadt fanden die Olympischen Sommerspiele 1972 statt?', 'München'],
  [2, 'Wie viele Punkte bringt ein Touchdown im American Football?', 'Sechs', '6'],
  [2, 'Welches Land gewann die Fußball-Weltmeisterschaft 2014?', 'Deutschland'],
  [2, 'Wie lang ist die Marathonstrecke?', '42,195 Kilometer', '42195 Meter', '42,195 km', '42 km'],
  [2, 'In welcher Sportart wurde Michael Jordan weltberühmt?', 'Basketball'],
  [2, 'Wie viele Spieler stehen beim Volleyball pro Team auf dem Feld?', 'Sechs', '6'],
  [2, 'Welches ist das bekannteste Straßenrennen der Formel 1?', 'Der Große Preis von Monaco', 'Monaco'],
  [2, 'Wie viele Punkte bringt ein Wurf hinter der Dreierlinie im Basketball?', 'Drei', '3'],
  [2, 'In welcher Wintersportart gibt es eine Kür?', 'Eiskunstlauf'],
  [2, 'Wie viele Sätze muss ein Herr im Grand-Slam-Finale gewinnen?', 'Drei', '3'],

  [3, 'Welcher Verein gewann die erste Bundesliga-Saison 1963/64?', '1. FC Köln', 'FC Köln', 'Köln'],
  [3, 'Wie heißt der Schwimmstil, bei dem man auf dem Rücken liegt?', 'Rückenschwimmen', 'Rücken'],
  [3, 'In welcher Stadt fanden die Olympischen Sommerspiele 2016 statt?', 'Rio de Janeiro', 'Rio'],
  [3, 'Wie viele Runden dauert ein WM-Boxkampf höchstens?', 'Zwölf', '12'],
  [3, 'Welcher Deutsche gewann 1985 als jüngster Spieler Wimbledon?', 'Boris Becker', 'Becker'],
  [3, 'Wie heißt die höchste spanische Fußballliga?', 'La Liga', 'Primera División'],
  [3, 'In welcher Sportart wird der Stanley Cup vergeben?', 'Eishockey'],
  [3, 'Wie heißt das Turngerät mit zwei parallelen Holmen?', 'Der Barren', 'Barren'],
  [3, 'Welches Land gewann die erste Fußball-Weltmeisterschaft 1930?', 'Uruguay'],
  [3, 'Wie nennt man drei Tore eines Spielers in einem Spiel?', 'Hattrick'],

  [4, 'Welcher Sprinter stellte 2009 den 100-Meter-Weltrekord auf?', 'Usain Bolt', 'Bolt'],
  [4, 'Welches Radrennen wird seit 1903 ausgetragen?', 'Die Tour de France', 'Tour de France'],
  [4, 'In welcher Sportart spricht man von einem „Eagle"?', 'Golf'],
  [4, 'Welcher Formel-1-Fahrer wurde bis 2004 siebenmal Weltmeister?', 'Michael Schumacher', 'Schumacher'],
  [4, 'Wie heißt der traditionelle japanische Ringkampf?', 'Sumo'],
  [4, 'Welches Land wurde am häufigsten Fußball-Weltmeister?', 'Brasilien'],
  [4, 'In welchem Jahr fanden die ersten modernen Olympischen Spiele statt?', '1896'],
  [4, 'In welcher Sportart wird mit einem Puck gespielt?', 'Eishockey'],
  [4, 'Wer war 1954 beim „Wunder von Bern" der deutsche Bundestrainer?', 'Sepp Herberger', 'Herberger'],
  [4, 'Wie heißt der Wettkampf aus Schwimmen, Radfahren und Laufen?', 'Der Triathlon', 'Triathlon'],

  [5, 'Wie heißt ein Golfschlag, der drei unter Par liegt?', 'Albatros', 'Albatross'],
  [5, 'Welcher Schachspieler war von 1985 bis 2000 Weltmeister?', 'Garri Kasparow', 'Kasparow', 'Kasparov'],
  [5, 'Wie heißt der Hindernislauf über 3000 Meter mit Wassergraben?', 'Der Hindernislauf', 'Hindernislauf', 'Steeplechase'],
  [5, 'In welchem Ort fanden die Olympischen Winterspiele 1936 statt?', 'Garmisch-Partenkirchen'],
  [5, 'Welcher Radrennfahrer wurde „der Kannibale" genannt?', 'Eddy Merckx', 'Merckx'],
  [5, 'Wie heißt die Auszeichnung für Europas besten Fußballer?', 'Der Ballon d’Or', 'Ballon d Or', 'Ballon dOr', 'Goldener Ball'],
  [5, 'Wie viele Steine spielt ein Curling-Team pro End?', 'Acht', '8'],
  [5, 'Welcher Boxer nannte sich selbst „The Greatest"?', 'Muhammad Ali', 'Ali', 'Cassius Clay'],
  [5, 'In welchem Jahr wurde Deutschland zum ersten Mal Fußball-Weltmeister?', '1954'],
  [5, 'Wie heißt der Zehnkampf-Wettbewerb der Frauen mit sieben Disziplinen?', 'Der Siebenkampf', 'Siebenkampf'],
]);

// ---------------------------------------------------------------------------

export const STANDARD_DE: TriviaPack = {
  id: 'standard-de',
  name: 'Standard (Deutsch)',
  description: 'Mitgeliefertes Paket: sechs Kategorien, fünf Schwierigkeitsstufen, 300 Fragen.',
  builtIn: true,
  language: 'de',
  questions: [...GEOGRAFIE, ...UNTERHALTUNG, ...GESCHICHTE, ...KUNST, ...WISSENSCHAFT, ...SPORT],
};

export const BUILT_IN_PACKS: TriviaPack[] = [STANDARD_DE];
