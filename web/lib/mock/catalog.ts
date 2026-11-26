import type { AspectId, Intent, Source } from "../types";

export interface ThemeSeed {
  id: string;
  name: string;
  aspect: AspectId;
  description: string;
  keywords: string[];
  /** baseline daily volume */
  rate: number;
  /** share of negative feedback */
  neg: number;
  intent: Intent;
  /** linear growth across the window, e.g. 0.8 = +80% by the end */
  slope?: number;
  /** anomaly injected into the series: day index of start, peak, magnitude multiplier */
  spike?: { start: number; peak: number; end: number; mult: number; kind: "spike" | "emerging_theme" };
  texts: string[];
}

export interface WorkspaceSeed {
  id: string;
  name: string;
  sources: Source[];
  themes: ThemeSeed[];
}

export const ASPECT_LABELS: Record<AspectId, string> = {
  performance_reliability: "Performance & Reliability",
  bugs_errors: "Bugs & Errors",
  ui_ux: "UI / UX",
  pricing_billing: "Pricing & Billing",
  account_access: "Account & Access",
  customer_service: "Customer Service",
  delivery_logistics: "Delivery & Logistics",
  ads: "Ads",
  content_catalog: "Content & Catalog",
  connectivity_devices: "Connectivity & Devices",
  features: "Features",
  privacy_security: "Privacy & Security",
  updates: "Updates",
  other: "Other",
};

const spotify: ThemeSeed[] = [
  {
    id: "th_shuffle", name: "Shuffle plays same songs", aspect: "features", intent: "complaint",
    description: "Users report that shuffle repeatedly plays the same small subset of tracks in large playlists.",
    keywords: ["shuffle", "same songs", "repeat", "random", "playlist"], rate: 46, neg: 0.82, slope: 0.15,
    texts: [
      "Shuffle on a 900 song playlist keeps cycling the same 30 tracks. It is not random at all.",
      "Why does shuffle always start with the same three songs? I have to skip ten times to hear anything new.",
      "Smart shuffle keeps injecting the same recommended tracks, I just want a true shuffle option back.",
      "I have 2,000 liked songs and shuffle plays maybe 50 of them on rotation. Very frustrating.",
      "Shuffle feels weighted toward recently added songs. Older favourites never come up anymore.",
    ],
  },
  {
    id: "th_ads", name: "Ads too frequent on free tier", aspect: "ads", intent: "complaint",
    description: "Free-tier listeners complain about ad load: long unskippable breaks, repeated ads and loud volume.",
    keywords: ["ads", "free tier", "commercial", "unskippable", "volume"], rate: 58, neg: 0.88, slope: 0.25,
    texts: [
      "Two 30 second ads after every single song now. The free tier is basically unusable.",
      "The same insurance ad played six times in one hour and it is twice as loud as the music.",
      "Ads interrupt mid song now instead of between tracks. That is new and it is awful.",
      "I get it, ads pay the bills, but a 90 second ad block after one song is too much.",
      "Video ads keep playing even with the screen locked and drain my data.",
    ],
  },
  {
    id: "th_android12", name: "App crashes on Android 12", aspect: "bugs_errors", intent: "bug_report",
    description: "Crash on launch and when resuming from background on Android 12 devices (Pixel 6, Galaxy S21) after the 8.7.x update.",
    keywords: ["crash", "android 12", "pixel", "launch", "force close"], rate: 14, neg: 0.94,
    spike: { start: 58, peak: 63, end: 78, mult: 5.2, kind: "spike" },
    texts: [
      "App crashes immediately on launch on my Pixel 6 since the latest update. Android 12.",
      "Spotify force closes every time I switch back to it from another app. Galaxy S21, Android 12.",
      "Reinstalled twice, cleared cache, still crashing on startup. Android 12 here.",
      "Crashes when I open the car view on Android 12. Was fine last week.",
      "Every time the screen locks the app dies and the music stops. Pixel 6 Pro.",
    ],
  },
  {
    id: "th_offline", name: "Offline downloads disappear", aspect: "bugs_errors", intent: "bug_report",
    description: "Downloaded playlists vanish or show as not downloaded after app restarts, especially on iOS 15.4.",
    keywords: ["offline", "downloads", "disappear", "re-download", "storage"], rate: 6, neg: 0.9,
    spike: { start: 128, peak: 141, end: 181, mult: 4.6, kind: "emerging_theme" },
    texts: [
      "All my downloaded playlists disappeared before a flight. Had nothing to listen to for 9 hours.",
      "Downloads keep vanishing every few days and I have to re-download 4GB of music.",
      "Offline mode says my songs are downloaded but they will not play without a connection.",
      "After the update my downloads show a grey arrow again. Storage is still being used though.",
      "Premium user, downloads wiped for the third time this month. What am I paying for?",
    ],
  },
  {
    id: "th_price", name: "Premium price increase", aspect: "pricing_billing", intent: "churn_risk",
    description: "Reaction to the Premium price increase announcement; users compare with Apple Music and YouTube Music.",
    keywords: ["price", "increase", "premium", "cancel", "apple music"], rate: 20, neg: 0.8,
    spike: { start: 92, peak: 96, end: 112, mult: 3.4, kind: "spike" },
    texts: [
      "Another price increase with no new features. Cancelling and moving to Apple Music.",
      "Premium went up again but the app keeps getting worse. Hard to justify the cost now.",
      "If the price goes up I would at least expect lossless audio like the competitors.",
      "The student discount barely covers the increase. Thinking about switching.",
      "Family plan is now more expensive than YouTube Music for the same thing.",
    ],
  },
  {
    id: "th_lyrics", name: "Lyrics missing", aspect: "content_catalog", intent: "feature_request",
    description: "Lyrics are unavailable or out of sync for many tracks, and missing in some regions.",
    keywords: ["lyrics", "sync", "missing", "karaoke", "region"], rate: 16, neg: 0.68, slope: 0.9,
    texts: [
      "Lyrics disappeared for most songs in my library. They were there last month.",
      "Lyrics are out of sync by a few seconds on almost every track.",
      "Please bring lyrics back for non-English songs, they only show for big hits now.",
      "The lyrics card says 'lyrics not available' for albums that definitely had them.",
    ],
  },
  {
    id: "th_bluetooth", name: "Bluetooth & car playback drops", aspect: "connectivity_devices", intent: "bug_report",
    description: "Playback stops or skips when connected to car head units and Bluetooth headphones.",
    keywords: ["bluetooth", "car", "carplay", "android auto", "disconnect"], rate: 18, neg: 0.85,
    texts: [
      "Music cuts out every few minutes over Bluetooth in my car. Other apps are fine.",
      "CarPlay shows the wrong song and the controls stop responding.",
      "Android Auto keeps pausing playback when I get a notification.",
      "My AirPods disconnect from Spotify specifically, everything else keeps playing.",
    ],
  },
  {
    id: "th_login", name: "Login loop after update", aspect: "account_access", intent: "bug_report",
    description: "Users are logged out and stuck in a login loop after the February update, including Facebook sign-in.",
    keywords: ["login", "logged out", "password", "facebook", "loop"], rate: 9, neg: 0.91,
    spike: { start: 33, peak: 36, end: 47, mult: 4.1, kind: "spike" },
    texts: [
      "Got logged out and now the app sends me back to the login screen every time.",
      "Facebook login just spins forever. I cannot access my account at all.",
      "Password reset email never arrives and I am locked out of Premium.",
      "Logged out on every device at once and the login button does nothing.",
    ],
  },
  {
    id: "th_library", name: "Library redesign confusing", aspect: "ui_ux", intent: "complaint",
    description: "The redesigned Your Library makes it harder to find albums, sort playlists and see downloads.",
    keywords: ["library", "redesign", "sort", "navigation", "layout"], rate: 15, neg: 0.74,
    texts: [
      "The new library layout is a mess. It takes four taps to get to my albums.",
      "Please let me sort playlists alphabetically again, the custom order keeps resetting.",
      "The grid view hides playlist names. Why change something that worked?",
      "Cannot tell which playlists are downloaded in the new library design.",
    ],
  },
  {
    id: "th_battery", name: "Battery drain in background", aspect: "performance_reliability", intent: "bug_report",
    description: "Heavy battery and CPU use while the app is in the background, even when paused.",
    keywords: ["battery", "drain", "background", "heat", "cpu"], rate: 11, neg: 0.88, slope: 0.3,
    texts: [
      "Spotify used 35% of my battery today and I only listened for an hour.",
      "Phone gets hot when Spotify is paused in the background.",
      "Battery drain is insane since the last update, even with the app closed.",
    ],
  },
  {
    id: "th_support", name: "Support chat unhelpful", aspect: "customer_service", intent: "complaint",
    description: "Support chat responses are scripted, slow, and do not resolve billing or account issues.",
    keywords: ["support", "chat", "agent", "refund", "response"], rate: 8, neg: 0.86,
    texts: [
      "Support chat just sends me the same troubleshooting article three times.",
      "Waited two days for a reply about a double charge and got a canned response.",
      "Agent closed my ticket without fixing anything.",
    ],
  },
  {
    id: "th_family", name: "Family plan address checks", aspect: "pricing_billing", intent: "complaint",
    description: "Family plan members are asked to re-verify their home address and get removed.",
    keywords: ["family plan", "address", "verify", "removed", "location"], rate: 7, neg: 0.83,
    texts: [
      "Kicked off my family plan because the address check failed. We live in the same house.",
      "Family plan keeps asking my kid to verify location with GPS. That is creepy.",
      "Our family plan got downgraded after an address check, no warning.",
    ],
  },
  {
    id: "th_hifi", name: "HiFi / lossless audio requests", aspect: "features", intent: "feature_request",
    description: "Requests for the promised HiFi lossless tier and better audio quality settings.",
    keywords: ["hifi", "lossless", "audio quality", "bitrate", "flac"], rate: 12, neg: 0.38, slope: 0.2,
    texts: [
      "When is HiFi coming? It was announced over a year ago.",
      "Please add lossless audio, it is the only reason I am considering Tidal.",
      "Would love a higher bitrate option for wired headphones.",
    ],
  },
  {
    id: "th_podcasts", name: "Podcast recommendations off", aspect: "features", intent: "feature_request",
    description: "Home feed pushes podcasts users are not interested in; requests to hide podcasts.",
    keywords: ["podcasts", "home", "recommendations", "hide", "feed"], rate: 10, neg: 0.6,
    texts: [
      "Please let me hide podcasts from the home screen, I only use Spotify for music.",
      "Home is full of podcasts I never asked for.",
      "Podcast recommendations have nothing to do with what I listen to.",
    ],
  },
  {
    id: "th_discover", name: "Discover Weekly praise", aspect: "features", intent: "praise",
    description: "Strong positive sentiment about Discover Weekly, Daylist and personalized mixes.",
    keywords: ["discover weekly", "recommendations", "mix", "love", "daylist"], rate: 22, neg: 0.07,
    texts: [
      "Discover Weekly is honestly the best feature in any music app. Found three new favourite artists.",
      "The personalized mixes are spot on, it really knows my taste.",
      "Release Radar every Friday is my favourite ritual.",
      "Discover Weekly keeps me on Spotify despite everything else.",
    ],
  },
  {
    id: "th_collab", name: "Collaborative playlists", aspect: "features", intent: "praise",
    description: "Positive feedback on Blend and collaborative playlists for sharing music with friends.",
    keywords: ["blend", "collaborative", "share", "friends", "playlist"], rate: 9, neg: 0.12,
    texts: [
      "Blend with my partner is such a fun feature.",
      "Collaborative playlists made our road trip planning so easy.",
      "Love sharing playlists with friends, works perfectly.",
    ],
  },
  {
    id: "th_catalog", name: "Artists missing from catalog", aspect: "content_catalog", intent: "complaint",
    description: "Albums greyed out or removed due to licensing; region-locked catalog.",
    keywords: ["greyed out", "unavailable", "removed", "region", "album"], rate: 7, neg: 0.7,
    texts: [
      "Half of this album is greyed out in my country.",
      "An entire artist discography just disappeared from my library.",
      "Songs in my playlists keep becoming unavailable.",
    ],
  },
];

function generic(prefix: string, rows: [string, AspectId, Intent, number, number, string[], ThemeSeed["spike"]?][]): ThemeSeed[] {
  return rows.map(([name, aspect, intent, rate, neg, texts, spike], i) => ({
    id: `${prefix}_${i}`,
    name,
    aspect,
    intent,
    rate,
    neg,
    spike,
    texts,
    description: `Feedback clustered around "${name.toLowerCase()}".`,
    keywords: name.toLowerCase().split(/\s+/).filter((w) => w.length > 3).slice(0, 4),
  }));
}

export const WORKSPACES: WorkspaceSeed[] = [
  { id: "spotify", name: "Spotify", sources: ["review", "ticket", "survey"], themes: spotify },
  {
    id: "apple", name: "Apple Music", sources: ["review", "survey"],
    themes: generic("ap", [
      ["Library sync loses songs", "bugs_errors", "bug_report", 20, 0.88, ["iCloud library sync removed half my songs.", "Library sync keeps duplicating albums."], { start: 70, peak: 75, end: 90, mult: 3.5, kind: "spike" }],
      ["Lossless audio praise", "features", "praise", 16, 0.08, ["Lossless and spatial audio sound incredible.", "Best sound quality of any streaming app."]],
      ["Android app is sluggish", "performance_reliability", "complaint", 12, 0.82, ["The Android app is slow and laggy.", "Scrolling the library on Android stutters."]],
      ["Price vs competitors", "pricing_billing", "churn_risk", 9, 0.7, ["Price is fine but the app is missing features.", "Considering switching to save money."]],
      ["Search is unreliable", "ui_ux", "complaint", 10, 0.76, ["Search never finds the exact song.", "Search results are cluttered with videos."]],
      ["Lyrics view loved", "features", "praise", 8, 0.1, ["Real-time lyrics are great.", "Sing mode is so fun."]],
    ]),
  },
  {
    id: "amazon", name: "Amazon", sources: ["review", "ticket"],
    themes: generic("am", [
      ["Late deliveries", "delivery_logistics", "complaint", 30, 0.9, ["Package arrived four days late.", "Delivery date keeps slipping."], { start: 120, peak: 126, end: 140, mult: 3, kind: "spike" }],
      ["Refund delays", "customer_service", "complaint", 14, 0.86, ["Still waiting on my refund after two weeks.", "Refund status stuck on processing."]],
      ["Prime value", "pricing_billing", "praise", 12, 0.2, ["Prime shipping is worth it.", "Prime Video plus shipping is good value."]],
      ["App checkout errors", "bugs_errors", "bug_report", 10, 0.9, ["Checkout fails with a payment error.", "App crashes at the payment step."]],
      ["Damaged packaging", "delivery_logistics", "complaint", 11, 0.84, ["Box arrived crushed.", "Item damaged due to poor packaging."]],
    ]),
  },
  {
    id: "uber", name: "Uber", sources: ["review", "ticket", "survey"],
    themes: generic("ub", [
      ["Surge pricing", "pricing_billing", "complaint", 25, 0.88, ["Surge pricing is out of control.", "Paid triple for a ten minute ride."]],
      ["Driver cancellations", "customer_service", "complaint", 20, 0.9, ["Drivers keep cancelling after accepting.", "Third cancellation in a row."], { start: 100, peak: 104, end: 118, mult: 2.8, kind: "spike" }],
      ["Map pickup errors", "bugs_errors", "bug_report", 12, 0.85, ["Pickup pin is always in the wrong place.", "Driver went to the wrong side of the street."]],
      ["Friendly drivers", "customer_service", "praise", 14, 0.06, ["Driver was kind and professional.", "Great ride, clean car."]],
      ["Uber Eats missing items", "delivery_logistics", "complaint", 13, 0.87, ["Order arrived missing half the items.", "Wrong order delivered."]],
    ]),
  },
  {
    id: "delta", name: "Delta", sources: ["review", "survey"],
    themes: generic("dl", [
      ["Flight delays", "delivery_logistics", "complaint", 22, 0.9, ["Delayed three hours with no updates.", "Missed my connection due to delay."], { start: 140, peak: 150, end: 170, mult: 2.5, kind: "spike" }],
      ["Lost baggage", "delivery_logistics", "complaint", 10, 0.93, ["My bag never arrived.", "Baggage claim took two hours."]],
      ["Crew service praise", "customer_service", "praise", 15, 0.07, ["Flight attendants were wonderful.", "Great crew, very attentive."]],
      ["App check-in bugs", "bugs_errors", "bug_report", 9, 0.86, ["Mobile check-in fails every time.", "Boarding pass would not load."]],
      ["SkyMiles devaluation", "pricing_billing", "churn_risk", 8, 0.8, ["SkyMiles are worth less every year.", "Award prices doubled."]],
    ]),
  },
  {
    id: "xbox", name: "Xbox", sources: ["review", "ticket"],
    themes: generic("xb", [
      ["Game Pass value", "pricing_billing", "praise", 20, 0.12, ["Game Pass is the best deal in gaming.", "So many games for the price."]],
      ["Console update failures", "updates", "bug_report", 12, 0.9, ["Update stuck at 0%.", "Console bricked after update."], { start: 50, peak: 54, end: 66, mult: 3.6, kind: "spike" }],
      ["Party chat disconnects", "connectivity_devices", "complaint", 14, 0.86, ["Party chat drops every 10 minutes.", "Can't hear friends in party."]],
      ["Controller drift", "connectivity_devices", "complaint", 10, 0.88, ["Controller drifts after a few months.", "Left stick drift again."]],
      ["Cloud gaming latency", "performance_reliability", "complaint", 9, 0.78, ["Cloud gaming is laggy.", "Input delay in cloud streaming."]],
    ]),
  },
];

export const SPOTIFY_RELATED: [string, string, number][] = [
  ["th_android12", "th_battery", 0.42],
  ["th_android12", "th_bluetooth", 0.31],
  ["th_offline", "th_library", 0.38],
  ["th_offline", "th_price", 0.22],
  ["th_price", "th_ads", 0.46],
  ["th_price", "th_family", 0.52],
  ["th_price", "th_hifi", 0.35],
  ["th_shuffle", "th_discover", 0.28],
  ["th_shuffle", "th_library", 0.24],
  ["th_lyrics", "th_catalog", 0.4],
  ["th_login", "th_support", 0.44],
  ["th_family", "th_support", 0.3],
  ["th_podcasts", "th_discover", 0.26],
  ["th_collab", "th_discover", 0.33],
  ["th_ads", "th_podcasts", 0.19],
];
