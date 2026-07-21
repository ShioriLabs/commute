import { describe, expect, it } from 'vitest'
import { findTopology } from 'utils/topology'

/*
 * Poster-truth spec for the TransJakarta BRT corridors, transcribed from the
 * official transjakarta.co.id route diagrams (see refresh-images/k*.md).
 *
 * This test is the SPEC for what TJ_TOPOLOGY (db/data/topology.tj.ts) should
 * become. It is expected to be RED against the current GTFS-derived topology
 * and to go GREEN once the topology is regenerated/corrected to match the
 * posters (loops, one-way splits, day/night west loop, Manggarai Temporer).
 *
 * Each corridor block is `name,code,stop` lines where stop is:
 *   ·  served both directions
 *   ↑  served toward the TOP terminus only (first line of the block)
 *   ↓  served toward the BOTTOM terminus only (last line of the block)
 * `code` may be a directional-platform pair `A/B` (one halte, one code per Arah)
 * or a `B…` code (Manggarai Temporer, dropped by the current generator).
 *
 * Not covered (no poster image provided): corridors 1, 10D. L7 is absent from
 * the GTFS feed.
 */
const CORRIDORS: Record<string, string> = {
  '2': `
Monumen Nasional,H00131P,·
Pecenongan,H00155P,↑
Balai Kota,H00006P,↓
Juanda,H00092P,↑
Istiqlal,H00078P,↑
Gambir,H00058P,↑
Gambir 2,H00059P,↓
Pejambon,H00045P,↑
RSPAD,H00202P,↑
Kwitang,H00116P,↓
Senen Raya,H00005P,↑
Senen TOYOTA Rangga,H00212P,·
Galur,H00057P,·
Rawa Selatan,H00194P,·
Pasar Cempaka Putih,H00144P,·
Cempaka Baru,H00034P,·
Sumur Batu,H00199P,·
Cempaka Mas,H00035P,·
Pedongkelan,H00157P,·
Perintis Kemerdekaan,H00004P,·
Pulomas,H00187P,·
Bermis,H00011P,·
Pulo Gadung,H00184P,·
`,
  '2A': `
Pulo Gadung,H00184P,·
Bermis,H00011P,·
Pulo Mas,H00187P,·
Perintis Kemerdekaan,H00004P,·
Pedongkelan,H00157P,·
Cempaka Mas,H00035P,·
Sumur Batu,H00199P,·
Cempaka Baru,H00034P,·
Pasar Cempaka Putih,H00144P,·
Rawa Selatan,H00194P,·
Galur,H00057P,·
Senen TOYOTA Rangga,H00212P,·
Kwitang,H00116P,·
Gambir 2,H00059P,↑
Balai Kota,H00006P,·
Petojo,H00170P,·
Roxy,H00200P,·
Grogol,H00070P,·
Jelambar,H00083P,·
Damai,H00077P,·
Taman Kota,H00235P,·
Jembatan Gantung,H00087P,·
Pulo Nangka,H00046P,·
Jembatan Baru,H00084P,·
Rawa Buaya,H00193P,·
`,
  '3': `
Kalideres,H00094P,·
Pesakih,H00169P,·
Sumur Bor,H00229P,·
Rawa Buaya,H00193P,·
Jembatan Baru,H00084P,·
Pulo Nangka,H00046P,·
Jembatan Gantung,H00087P,·
Taman Kota,H00235P,·
Damai,H00077P,·
Jelambar,H00083P,·
Grogol,H00070P,·
Roxy,H00200P,·
Petojo,H00170P,·
Monumen Nasional,H00131P,·
`,
  '3F': `
Kalideres,H00094P,·
Pesakih,H00169P,·
Sumur Bor,H00229P,·
Rawa Buaya,H00193P,·
Jembatan Baru,H00084P,·
Pulo Nangka,H00046P,·
Jembatan Gantung,H00087P,·
Taman Kota,H00235P,·
Damai,H00077P,·
Jelambar,H00083P,·
Grogol Reformasi,H00071P,↓
Tanjung Duren,H00210S/H00211S,·
Kota Bambu,H00204S/H00209S,·
Kemanggisan,H00220S/H00224S,·
Petamburan,H00036C,·
Gerbang Pemuda,H00218S/H00219S,·
Senayan Bank Jakarta,H00067P,·
`,
  '3H': `
Damai,H00077P,·
Jelambar,H00083P,·
Grogol,H00070P,·
Roxy,H00200P,·
Petojo,H00170P,·
Harmoni,H00278P,·
Sawah Besar,H00280P,·
Mangga Besar,H00281P,·
Taman Sari,H00133P,·
Glodok,H00068P,·
Kali Besar,H00093P,↓
Museum Sejarah Jakarta,H00132P,↓
Kota,H00275P,·
`,
  '4': `
Pulo Gadung,H00184P,·
Pasar Pulo Gadung,H00152P,·
Pemuda Merdeka,H00252P,·
Layur,H00121P,·
Pemuda Rawamangun,H00161P,·
Velodrome,H00258P,·
Kayu Jati,H00230P,·
Rawamangun,H00254P,·
Simpang Pramuka,H00181P,·
Pramuka Sari,H00182P,·
Utan Kayu,H00255P,·
Pasar Genjing,H00146P,·
Flyover Pramuka,H00129P,↑
Matraman,H00128P,↓
Tegalan,H00245P,↓
Kesatrian,H00217P,↓
Manggarai Temporer,B08301P/B08302P,·
Pasar Rumput,H00153P,·
Halimun,H00073P,·
Galunggung,H00283P,·
`,
  '4D': `
Pulo Gadung,H00184P,·
Pasar Pulo Gadung,H00152P,·
Pemuda Merdeka,H00252P,·
Layur,H00121P,·
Pemuda Rawamangun,H00161P,·
Velodrome,H00258P,·
Kayu Jati,H00230P,·
Rawamangun,H00254P,·
Simpang Pramuka,H00181P,·
Pramuka Sari,H00182P,·
Utan Kayu,H00255P,·
Pasar Genjing,H00146P,·
Flyover Pramuka,H00129P,↑
Matraman,H00128P,↓
Tegalan,H00245P,↓
Kesatrian,H00217P,↓
Manggarai Temporer,B08301P/B08302P,·
Pasar Rumput,H00153P,·
Halimun,H00073P,·
Setiabudi Integritas,H00215P,↓
Kuningan Madya,H00114P,·
Karet Kuningan,H00098P,·
Rasuna Said,H00069P,·
Kuningan,H00043P,·
Patra Kuningan,H00154P,·
`,
  '5': `
Kampung Melayu,H00095P,·
Jatinegara,H00082P,↑
Bali Mester,H00148P,↑
Matraman Baru,H00104P,·
Kesatrian,H00217P,·
Tegalan,H00245P,·
Matraman,H00128P,·
Paseban,H00205P,·
Salemba,H00206P,·
Kramat Sentiong,H00112P,·
Pal Putih,H00136P,·
Jaga Jakarta,H00213P,·
Lapangan Banteng,H00018P,·
Pasar Baru Timur,H00142P,·
Jembatan Merah,H00088P,·
Gunung Sahari,H00072P,·
Pademangan,H00134P,·
Ancol,H00003P,·
`,
  '5C': `
Cililitan,H00171P,·
Cawang Cililitan,H00013P,·
Cawang Sentral,H00030P,·
Cawang,H00276P,·
Cawang Baru,H00028P,·
Gelanggang Remaja,H00066P,·
Bidara Cina,H00012P,·
Kampung Melayu,H00095P,·
Jatinegara,H00082P,↑
Bali Mester,H00148P,↑
Matraman Baru,H00104P,·
Kesatrian,H00217P,·
Tegalan,H00245P,·
Matraman,H00128P,·
Paseban,H00205P,·
Salemba,H00206P,·
Kramat Sentiong,H00112P,·
Pal Putih,H00136P,·
Kwitang,H00116P,↓
Balai Kota,H00006P,↓
Lapangan Banteng,H00018P,↑
Monumen Nasional,H00131P,↓
Pecenongan,H00155P,↓
Juanda,H00092P,·
`,
  '6': `
Ragunan,H00191P,·
Simpang Ragunan Ar-Raudhah,H00044P,·
Jati Barat,H00221P,·
Jati Padang,H00081P,·
Pejaten,H00158P,·
Buncit Indah,H00021P,·
Warung Jati,H00262P,·
Warung Buncit,H00075P,·
Duren Tiga,H00049P,·
Mampang Prapatan,H00123P,·
Underpass Kuningan,H00115P,·
Patra Kuningan,H00154P,·
Kuningan,H00043P,·
Rasuna Said,H00069P,·
Karet Kuningan,H00098P,·
Kuningan Madya,H00114P,·
Setiabudi Integritas,H00215P,·
Flyover Kuningan,H00118P,↓
Halimun,H00073P,↓
Galunggung,H00283P,·
`,
  '6A': `
Balai Kota,H00006P,·
Kebon Sirih,H00267S/H00268S,·
M.H. Thamrin,H00207P,·
Bundaran HI ASTRA,H00022P,·
Setiabudi Integritas,H00215P,·
Kuningan Madya,H00114P,·
Karet Kuningan,H00098P,·
Rasuna Said,H00069P,·
Kuningan,H00043P,·
Patra Kuningan,H00154P,·
Underpass Kuningan,H00115P,·
Mampang Prapatan,H00123P,·
Duren Tiga,H00049P,·
Warung Buncit,H00075P,·
Warung Jati,H00262P,·
Buncit Indah,H00021P,·
Pejaten,H00158P,·
Jati Padang,H00081P,·
Jati Barat,H00221P,·
Simpang Ragunan Ar-Raudhah,H00044P,·
Ragunan,H00191P,·
`,
  '6B': `
Balai Kota,H00006P,·
Kebon Sirih,H00267S/H00268S,·
M.H. Thamrin,H00207P,·
Bundaran HI ASTRA,H00022P,·
Tosari,H00251P,·
Dukuh Atas,H00047P,·
Karet,H00099P,·
Semanggi,H00027C,↑
Widya Chandra Telkomsel,H00137S/H00120S,·
Denpasar,H00119S/H00109S,·
Mampang Prapatan,H00123P,·
Duren Tiga,H00049P,·
Warung Buncit,H00075P,·
Warung Jati,H00262P,·
Buncit Indah,H00021P,·
Pejaten,H00158P,·
Jati Padang,H00081P,·
Jati Barat,H00221P,·
Simpang Ragunan Ar-Raudhah,H00044P,·
Ragunan,H00191P,·
`,
  '6V': `
Ragunan,H00191P,·
Simpang Ragunan Ar-Raudhah,H00044P,·
Jati Barat,H00221P,·
Jati Padang,H00081P,·
Pejaten,H00158P,·
Buncit Indah,H00021P,·
Warung Jati,H00262P,·
Warung Buncit,H00075P,·
Duren Tiga,H00049P,·
Mampang Prapatan,H00123P,·
Tegal Mampang,H00246P,·
Rawa Barat,H00192P,·
Pasar Santa,H00249P,·
ASEAN,H00265P,↑
Masjid Agung,H00127P,·
Bundaran Senayan,H00023P,·
Senayan Bank Jakarta,H00067P,·
`,
  '7': `
Kampung Melayu,H00095P,·
Bidara Cina,H00012P,·
Gelanggang Remaja,H00066P,·
Cawang Baru,H00028P,·
Cawang,H00276P,·
Cawang Sentral,H00030P,·
Cawang Cililitan,H00013P,·
Cililitan,H00171P,·
Kramat Jati,H00150P,·
Pasar Induk,H00147P,·
Trikora,H00196P,·
Flyover Raya Bogor,H00056P,·
Tanah Merdeka,H00238S/H00239S,·
Kampung Rambutan,H00096P,·
`,
  '7F': `
Juanda,H00092P,·
Pecenongan,H00155P,↑
Monumen Nasional,H00131P,↑
Pasar baru,H00141P,↓
Balai Kota,H00006P,↑
Kwitang,H00116P,·
Senen TOYOTA Rangga,H00212P,·
Galur,H00057P,·
Rawa Selatan,H00194P,·
Pasar Cempaka Putih,H00144P,·
Cempaka Baru,H00034P,·
Sumur Batu,H00199P,·
Cempaka Mas,H00035P,↑
Cempaka Putih,H00033P,↑
Pulomas Bypass,H00188P,·
Kayu Putih Rawasari,H00100P,·
Pemuda Pramuka,H00160P,·
Utan Kayu Rawamangun,H00256P,·
Pasar Induk,H00147P,·
Trikora,H00196P,·
Flyover Raya Bogor,H00056P,·
Tanah Merdeka,H00238S/H00239S,·
Kampung Rambutan,H00096P,·
`,
  '8': `
Pasar Baru,H00141P,·
Juanda,H00092P,·
Pecenongan,H00155P,·
Petojo,H00170P,·
Tarakan,H00201P,·
Tomang Raya,H00250P,·
Tanjung Duren,H00210S/H00211S,·
Grogol Reformasi,H00071P,↑
Jelambar,H00083P,·
Damai,H00077P,·
Kedoya,H00106P,·
Kedoya Panjang,H00105P,·
Duri Kepa,H00050P,·
Kebon Jeruk,H00103P,·
Kelapa Dua Sasak,H00107P,·
Pos Pengumben,H00180P,·
Arteri,H00167P,·
Permata Hijau,H00166P,·
Simprug,H00216P,·
Kebayoran,H00149P,·
Bungur,H00102P,·
Tanah Kusir,H00237P,·
Pondok Indah,H00178P,·
Underpass Lebak Bulus,H00177P,·
Pondok Pinang,H00179P,↑
Lebak Bulus,H00122P,·
`,
  '9': `
Pinang Ranti,H00173P,·
Makasar,H00060P,·
Cawang Sentral,H00030P,·
Cawang,H00276P,·
Ciliwung,H00062S/H00061S,·
Cikoko,H00064S/H00063S,·
Tebet Eco Park,H00242S/H00241S,·
Pancoran Tugu,H00139P,·
Pancoran,H00203S/H00198S,·
Tegal Parang,H00244S/H00243S,·
Simpang Kuningan,H00113P,·
Denpasar,H00119S/H00109S,·
Widya Chandra Telkomsel,H00137S/H00120S,·
Semanggi,H00027C,·
Gerbang Pemuda,H00218S/H00219S,·
Petamburan,H00036C,·
Kemanggisan,H00220S/H00224S,·
Kota Bambu,H00204S/H00209S,·
Tanjung Duren,H00210S/H00211S,·
Grogol Reformasi,H00071P,·
Kali Grogol,H00197S/H00138S,·
Jembatan Besi,H00085P,·
Jembatan Dua,H00086P,·
Jembatan Tiga,H00089P,·
Penjaringan,H00164P,·
Pluit,H00174P,·
`,
  '9A': `
Cililitan,H00171P,·
Cawang Cililitan,H00013P,·
Cawang,H00276P,·
Ciliwung,H00062S/H00061S,·
Cikoko,H00064S/H00063S,·
Tebet Eco Park,H00242S/H00241S,·
Pancoran Tugu,H00139P,·
Pancoran,H00203S/H00198S,·
Tegal Parang,H00244S/H00243S,·
Simpang Kuningan,H00113P,·
Denpasar,H00119S/H00109S,·
Widya Chandra Telkomsel,H00137S/H00120S,·
Semanggi,H00027C,·
Gerbang Pemuda,H00218S/H00219S,·
Petamburan,H00036C,·
Kemanggisan,H00220S/H00224S,·
Kota Bambu,H00204S/H00209S,·
Tanjung Duren,H00210S/H00211S,·
Grogol Reformasi,H00071P,·
`,
  '9C': `
Pinang Ranti,H00173P,·
Makasar,H00060P,·
Cawang Sentral,H00030P,·
Cawang,H00276P,·
Ciliwung,H00062S/H00061S,·
Cikoko,H00064S/H00063S,·
Tebet Eco Park,H00242S/H00241S,·
Pancoran Tugu,H00139P,·
Pancoran,H00203S/H00198S,·
Tegal Parang,H00244S/H00243S,·
Simpang Kuningan,H00113P,·
Denpasar,H00119S/H00109S,·
Widya Chandra Telkomsel,H00137S/H00120S,·
Semanggi,H00027C,↑
Senayan Bank Jakarta,H00067P,·
Bundaran Senayan,H00023P,·
`,
  '9N': `
Pinang Ranti,H00173P,·
Makasar,H00060P,·
Cawang Sentral,H00030P,·
Simpang Cawang,H00029P,·
`,
  '10': `
Tanjung Priok,H00240P,·
Mambo,H00051P,·
Koja,H00165P,·
Walikota Jakarta Utara,H00260S/H00261S,·
Plumpang,H00175P,·
Sunter Kelapa Gading,H00233P,·
Kodamar,H00263P,·
Simpang Cempaka,H00032P,·
Cempaka Putih,H00033P,·
Pulomas Bypass,H00188P,·
Kayu Putih Rawasari,H00100P,·
Pemuda Pramuka,H00160P,·
Utan Kayu Rawamangun,H00256P,·
Pisangan,H00002P,·
Flyover Jatinegara,H00037C,·
Pedati Perumpung,H00156P,·
Kebon Nanas,H00039P,·
Halim,H00162P,·
Simpang Cawang,H00029P,·
Cawang Sentral,H00030P,·
Cawang Cililitan,H00013P,·
PGC,H00172P,·
`,
  '10H': `
Tanjung Priok,H00240P,·
Pademangan,H00134P,·
Gunung Sahari,H00072P,·
Jembatan Merah,H00088P,·
Pasar Baru Timur,H00142P,·
Juanda,H00092P,·
Pecenongan,H00155P,·
Petojo,H00170P,·
Tarakan,H00201P,·
Tomang Raya,H00250P,·
Kota Bambu,H00204S/H00209S,·
Kemanggisan,H00220S/H00224S,·
Petamburan,H00036C,·
Gerbang Pemuda,H00218S/H00219S,·
Senayan Bank Jakarta,H00067P,·
Bundaran Senayan,H00023P,·
`,
  '11': `
Kampung Melayu,H00095P,·
Jatinegara,H00082P,↑
Stasiun Jatinegara,H00225P,·
Flyover Jatinegara,H00037C,·
Pasar Enjo,H00145P,·
Flyover Cipinang,H00076P,·
Cipinang,H00038P,·
Stasiun Klender,H00226P,·
Klender,H00054P,·
Kampung Sumur,H00097P,·
Buaran,H00017P,·
Simpang Buaran,H00055P,·
Flyover Pondok Kopi,H00168P,·
Penggilingan,H00163P,·
Walikota Jakarta Timur,H00259P,·
Pulo Gebang,H00186P,·
`,
  '12': `
Tanjung Priok,H00240P,·
Mambo,H00051P,·
Koja,H00165P,·
Walikota Jakarta Utara,H00260S/H00261S,·
Plumpang,H00175P,·
Sunter Kelapa Gading,H00233P,·
Sunter Boulevard Barat,H00231P,·
Sunter Karya,H00232P,·
Sunter Utara,H00222P,·
Danau Agung,H00042P,·
Landasan Pacu,H00108P,·
Jembatan Merah,H00088P,·
Gunung Sahari,H00072P,·
Mangga Dua,H00125P,·
Mangga Dua Raya,H00140P,·
Kota,H00275P,↑
Kali Besar,H00093P,↓
Museum Sejarah Jakarta,H00132P,↑
Gedong Panjang,H00065P,↑
Bandengan,H00007P,↓
Pakin,H00135P,↑
Penjaringan,H00164P,↓
Pluit Selatan,H00117P,↑
Pluit,H00174P,·
`,
  '13': `
Tegal Mampang,H00246P,·
Rawa Barat,H00192P,·
Pasar Santa,H00249P,·
CSW,H00041P,·
Mayestik,H00130P,·
Velbak,H00257P,·
Kebayoran Lama,H00101P,·
Seskoal,H00214P,·
Cipulir,H00040P,·
Swadarma ParagonCorp,H00234P,·
JORR,H00091P,·
Petukangan D'MASIV,H00001P,·
Puri Beta 1,H00189P,↑
CBD Ciledug,H00031P,·
Puri Beta 2,H00190P,·
`,
  '13B': `
Puri Beta 2,H00190P,·
Puri Beta 1,H00189P,↓
Petukangan D'MASIV,H00001P,·
JORR,H00091P,·
Swadarma ParagonCorp,H00234P,·
Cipulir,H00040P,·
Seskoal,H00214P,·
Kebayoran Lama,H00101P,·
Velbak,H00257P,·
Mayestik,H00130P,·
CSW,H00041P,·
Pasar Santa,H00249P,·
Rawa Barat,H00192P,·
Tegal Mampang,H00246P,↑
Pancoran Arah Barat,H00203S,↑
Pancoran Arah Timur,H00198S,·
`,
  '13E': `
Puri Beta 2,H00190P,·
Puri Beta 1,H00189P,↓
Petukangan D'MASIV,H00001P,·
JORR,H00091P,·
Swadarma ParagonCorp,H00234P,·
Cipulir,H00040P,·
Seskoal,H00214P,·
Kebayoran Lama,H00101P,·
Velbak,H00257P,·
Mayestik,H00130P,·
CSW,H00041P,·
Pasar Santa,H00249P,·
Rawa Barat,H00192P,·
Tegal Mampang,H00246P,↑
Simpang Kuningan,H00113P,↓
Underpass Kuningan,H00115P,↑
Patra Kuningan,H00154P,·
Kuningan,H00043P,·
Rasuna Said,H00069P,·
Karet Kuningan,H00098P,·
Kuningan Madya,H00114P,·
Setiabudi Integritas,H00215P,·
Flyover Kuningan,H00118P,·
`,
  '14': `
Jakarta International Stadium,H00273P,·
Jembatan Item,H00287P,·
Danau Sunter,H00286P,·
Danau Agung,H00042P,·
Landasan Pacu,H00108P,·
JIEXPO Kemayoran,H00090P,↑
Kemayoran,H00288P,·
Tanah Tinggi,H00285P,·
Senen TOYOTA Rangga,H00212P,·
Senen Raya,H00005P,↑
`,
  'L13E': `
Puri Beta 2,H00190P,·
Puri Beta 1,H00189P,↓
Petukangan D'MASIV,H00001P,·
Velbak,H00257P,·
CSW,H00041P,·
Tegal Mampang,H00246P,↑
Simpang Kuningan,H00113P,↓
Underpass Kuningan,H00115P,↑
Patra Kuningan,H00154P,·
Kuningan,H00043P,·
Rasuna Said,H00069P,·
Karet Kuningan,H00098P,·
Kuningan Madya,H00114P,·
Setiabudi Integritas,H00215P,·
Flyover Kuningan,H00118P,·
`
}

type Dir = '·' | '↑' | '↓'
interface SpecStop { codes: string[], dir: Dir }

// Parse a `name,code,stop` block into ordered stops. `code` may be `A/B`.
function parseStops(block: string): SpecStop[] {
  return block
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .map((line) => {
      const parts = line.split(',')
      const dir = parts.at(-1)!.trim() as Dir
      const code = parts.at(-2)!.trim()
      return { codes: code.split('/'), dir }
    })
}

// Map every directional-platform pair code to a single representative
// (`codes[0]`), so a halte served via a different `…S` platform per direction
// (and the Manggarai `B…` pair) collapses to one identity for comparison.
function buildCanon(all: Record<string, SpecStop[]>): (code: string) => string {
  const rep = new Map<string, string>()
  for (const stops of Object.values(all)) {
    for (const s of stops) {
      if (s.codes.length > 1) for (const c of s.codes) rep.set(c, s.codes[0]!)
    }
  }
  return (code: string) => rep.get(code) ?? code
}

// Direction toward the BOTTOM terminus: stops served both-ways or ↓, in order.
function downSeq(stops: SpecStop[], canon: (c: string) => string): string[] {
  return stops.filter(s => s.dir === '·' || s.dir === '↓').map(s => canon(s.codes[0]!))
}

// Direction toward the TOP terminus: stops served both-ways or ↑, reversed.
function upSeq(stops: SpecStop[], canon: (c: string) => string): string[] {
  return stops.filter(s => s.dir === '·' || s.dir === '↑').map(s => canon(s.codes[0]!)).reverse()
}

// A corridor is asymmetric when any stop is one-way OR any halte has a
// per-direction platform pair (the reverse direction uses different codes).
function isAsymmetric(stops: SpecStop[]): boolean {
  return stops.some(s => s.dir !== '·' || s.codes.length > 1)
}

const PARSED: Record<string, SpecStop[]> = Object.fromEntries(
  Object.entries(CORRIDORS).map(([code, block]) => [code, parseStops(block)])
)
const canon = buildCanon(PARSED)

describe('derivation helpers', () => {
  it('canonicalizes directional pairs to a single representative', () => {
    const c = buildCanon({ x: parseStops('A,H1/H2,·\nB,H3,·') })
    expect(c('H1')).toBe('H1')
    expect(c('H2')).toBe('H1')
    expect(c('H3')).toBe('H3')
  })

  it('derives DOWN (·,↓ top→bottom) and UP (·,↑ bottom→top)', () => {
    const stops = parseStops('T,H1,·\nA,H2,↑\nB,H3,↓\nU,H4,·')
    const c = buildCanon({ x: stops })
    expect(downSeq(stops, c)).toEqual(['H1', 'H3', 'H4'])
    expect(upSeq(stops, c)).toEqual(['H4', 'H2', 'H1'])
  })

  it('flags asymmetric when any one-way stop or directional pair is present', () => {
    expect(isAsymmetric(parseStops('A,H1,·\nB,H2,·'))).toBe(false)
    expect(isAsymmetric(parseStops('A,H1,·\nB,H2,↑'))).toBe(true)
    expect(isAsymmetric(parseStops('A,H1/H2,·\nB,H3,·'))).toBe(true)
  })
})

// Corridor 13's west end is a day/night loop (CBD Ciledug served 05–22h, Puri Beta 2 served
// 22–05h) that the ·/↑/↓ vocabulary can't express. It keeps its bespoke day/night HAND_OVERRIDE
// in generateTJTopology.ts and is exempt from this ordered-per-direction spec.
const EXEMPT = new Set(['13'])

describe('TJ_TOPOLOGY matches the poster spec', () => {
  it.each(Object.keys(CORRIDORS).filter(c => !EXEMPT.has(c)))('corridor %s', (code) => {
    const stops = PARSED[code]!
    const topo = findTopology('TJ', code)
    expect(topo, `corridor ${code} is missing from TJ_TOPOLOGY`).not.toBeNull()

    const pathC = topo!.path.map(s => canon(s.station))
    const revC = topo!.pathReverse ? topo!.pathReverse.map(s => canon(s.station)) : null
    const DOWN = downSeq(stops, canon)
    const UP = upSeq(stops, canon)

    if (isAsymmetric(stops)) {
      expect(revC, `corridor ${code} should have a pathReverse (asymmetric corridor)`).not.toBeNull()
      // path direction is not fixed to top/bottom by the generator, so accept
      // either assignment of {path, pathReverse} to {DOWN, UP}.
      const actual = [pathC.join(' > '), revC!.join(' > ')].sort()
      const expected = [DOWN.join(' > '), UP.join(' > ')].sort()
      expect(actual).toEqual(expected)
    } else {
      // symmetric: path is DOWN in either orientation; pathReverse (if any) mirrors it.
      const candidates = [DOWN.join(' > '), [...DOWN].reverse().join(' > ')]
      expect(candidates).toContain(pathC.join(' > '))
      if (revC) expect(revC.join(' > ')).toBe([...pathC].reverse().join(' > '))
    }
  })
})
