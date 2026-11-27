// Parametri centrali della mappa: modificare qui, non nel codice.
export const CONFIG = {
  // In sviluppo il modello è in public/models; nella pagina pubblicata è un asset caricato a parte.
  // il modello è nel progetto (public/models); solo la pagina pubblicata su Claude lo legge dall'archivio della pagina
  modelUrl: import.meta.env.VITE_CLAUDE_ARTIFACT ? '/_blob/f1669437668eca63d073655983628dcd' : './models/plastico.glb',
  localitaUrl: './data/localita.json',
  itinerariUrl: './data/itinerari.json',

  // Scala: nel modello 1 unità ≈ 1 metro in orizzontale.
  // Il terreno ha un'esagerazione verticale di 1,6 (scala Y del nodo Terreno_3D).
  unitsPerMeter: 1,
  modelExaggeration: 1.6,      // esagerazione verticale con cui è costruito il plastico (scala Y di Terreno_3D)
  verticalExaggeration: 1.25,  // esagerazione usata nella mappa (ridotta rispetto al modello)

  // Aspetto del plastico
  wallColor: '#9aa2a7',        // pareti esterne del plastico
  wallEdge: 45,                // m: fascia dal bordo considerata parete
  roofColor: '#b3362b',        // tetti dei monumenti
  monumentColor: '#b0895c',    // monumenti (escluso il tetto): marrone chiaro
  roofPattern: /tett|falda|copertura|cuspide/i,
  roofSkipMonuments: ['parco archeologico di livelet'],  // monumenti senza tetti rossi
  roofExclude: /sottotetto|cornice|terrazza|copertina|sostegno|legature/i,

  // Prefisso dei nodi monumento (accetta anche il refuso "monumneto" presente nel file).
  // GLTFLoader sostituisce gli spazi dei nomi con "_".
  monumentPattern: /^monu(mento|mneto)[\s_]+/i,
  terrainNode: 'Terreno_3D',
  baseNode: 'Basamento',

  // Veduta aerea da sud (assonometria simulata: prospettica a FOV stretto)
  aerial: {
    fov: 22,
    position: [0, 36000, 76000] as [number, number, number],
    target: [0, 0, 0] as [number, number, number],
    minDistance: 9000,         // m: la mappa non si avvicina più di così (veduta aerea)
    minHeight: 4500,           // m: altezza minima della camera sopra il terreno
    maxDistance: 160000,
    maxPolarAngle: Math.PI * 0.47,
  },

  // FASE 2 – Scale importance code: distanza massima della camera (m) a cui compare ogni livello
  labels: {
    maxDistance: { 1: Infinity, 2: 40000, 3: 17000 } as Record<number, number>,
    heightOffset: 30,          // sollevamento del punto sopra il terreno
    occlusion: true,           // nasconde i nomi coperti dai rilievi
  },

  // FASE 3 – Itinerari animati
  routes: {
    joinGap: 3000,             // m: tratti dello stesso itinerario uniti nel volo se distano meno di così
    minBranch: 2000,           // m: diramazioni più corte non entrano nel volo
    lineWidthFar: 3,           // px: spessore con la camera alta (veduta d'insieme)
    lineWidthNear: 14,         // px: spessore con la camera vicina al terreno
    farHeight: 36000,          // m: altezza della camera a cui la linea è sottile
    nearHeight: 3000,          // m: altezza a cui la linea è spessa
    lineWidth: 10,             // px: spessore della linea, costante a qualunque distanza
    step: 20,                  // m: passo con cui il tracciato viene appoggiato al terreno
    lift: 12,                  // m sopra il terreno
    sphereSpeed: 900,          // m/s lungo il percorso
    sphereScreenSize: 0.0014,  // raggio della sfera in proporzione alla distanza dalla camera (-75% rispetto alla prima versione)
    sphereMinRadius: 6,        // m: raggio minimo (vista ravvicinata)
  },

  // FASE 4 – Monumenti: scala 1 = come nel modello (ingranditi). Avvicinandosi scendono fino a "naturale".
  monuments: {
    farDistance: 45000,
    sink: 1,                   // m: affondamento nel terreno per evitare fessure sui pendii        // oltre questa distanza il monumento ha la scala del modello
    defaultNaturalScale: 1 / 4, // dimensione minima da vicino rispetto al modello (1/20 sarebbe la scala reale: si riducono meno)
    naturalScale: {} as Record<string, number>, // eccezioni per nome, es. { 'campanile roganzuolo': 0.04 }
    sizeFactor: { 'parco archeologico di livelet': 1.5 } as Record<string, number>, // ingrandimento a ogni distanza
    // spostamenti: monumenti del modello fuori posto, riportati sul punto corretto (u, v della mappa)
    position: { 'abbazia di follina': { u: 0.4056, v: 0.2935 } } as Record<string, { u: number; v: number }>,
  },

  // FASE 5 – Contenuti multimediali
  content: {
    url: './data/contenuti.json',
    activationDistance: 12000, // m: i contenuti compaiono avvicinandosi sotto questa distanza
    fadeSeconds: 0.4,
    // altezza dell'icona a bullet point (disco + asta) sullo schermo: piccola da lontano, grande da vicino
    iconHeightFarPx: 61,       // px alla distanza iconFarDistance e oltre
    iconHeightNearPx: 280,     // px alla distanza iconNearDistance e più vicino
    iconFarDistance: 70000,    // m
    iconNearDistance: 6000,    // m
    spacingPx: 128,             // distanza tra contenuti dello stesso punto (alla dimensione massima)
    sphereRadiusPx: 56,        // sfera delle foto 360 (alla dimensione sphereNearRefPx)
    sphereFarRefPx: 46,        // crescita delle sfere con la distanza: da sphereFarRefPx/sphereNearRefPx a 1
    sphereNearRefPx: 118,
    stemHeightPx: 116,          // linea tra il punto e la sfera 360
  },

  // FASE 6 – Interfaccia
  audioUrl: './data/audio.json',     // audio geoposizionati degli itinerari
  giochiUrl: './data/giochi.json',   // giochi abilitati (vuoto: "Prossimamente")
  poiView: { distance: 7600, height: 5400, monumentDistance: 8000, monumentHeight: 5600 },   // inquadrature (m)
  groundFov: 60,             // campo visivo (gradi) in prima persona e nel volo; la veduta aerea usa aerial.fov   // inquadratura di un punto selezionato (m)
  firstPerson: {
    enabled: false,          // prima persona disattivata: niente pulsanti, niente discesa sul terreno con il clic
    avatarScale: 6,          // l'avatar (1,7 m) è ingrandito per essere visibile sul plastico
    avatarColor: '#d2452f',
    walkSpeed: 45,           // m/s
    runSpeed: 160,           // m/s (Maiusc o joystick a fondo)
    cameraDistance: 7,       // dietro l'avatar, in altezze-persona
    cameraHeight: 2.2,
    lookSensitivity: 0.004,
    landingSeconds: 1.8,
    nearDistance: 600,       // m: contenuti "vicino a te"
  },
  flight: {
    northUp: true,           // camera sempre a sud del percorso, rivolta a nord (false = segue la direzione di marcia)
    speechSpeed: 70,         // m/s (a 1×) durante un commento: la sfera rallenta molto
    audioLate: 2500,         // m: un commento superato da più di così viene saltato
    imageRadius: 800,        // m: solo le immagini collegate a punti entro questa distanza dal percorso
    imageWindow: 3500,       // m: la finestra mostra l'immagine da questa distanza prima a questa dopo il punto
    monumentBoost: 3,        // ingrandimento dei monumenti durante il volo
    musicUrl: '',            // file musicale (MP3/OGG) facoltativo; vuoto = musica generata dalla pagina
    musicVolume: 0.5,
    musicDuck: 0.04,         // volume della musica durante il parlato
    height: 6500,            // m: altezza della camera sopra il percorso
    backRatio: 1,            // arretramento = altezza × backRatio (1 = sguardo a 45° verso il percorso)
    speed: 900,              // m/s a velocità 1×
    speeds: [0.5, 1, 2, 4],
    directionWindow: 500,    // m: tratto su cui si media la direzione di marcia
    turnSmoothing: 1.2,      // rapidità con cui la camera segue le curve
    minClearance: 300,       // m: distanza minima della camera dal terreno
    approachSeconds: 2.5,
    audioRadius: 400,        // m: raggio di attivazione predefinito dei commenti audio
    markerScreenSize: 0.016, // sfera nel punto inquadrato: raggio in proporzione alla distanza dalla camera
    markerMinRadius: 6,
  },


  colors: {
    background: '#dfe7ec',
    fog: '#dfe7ec',
  },
};
