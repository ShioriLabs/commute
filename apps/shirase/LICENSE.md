# License

Copyright (c) 2026 Shiori Labs

shirase serves several kinds of material, and each kind has its own license.
This file covers `apps/shirase`. The rest of the repository is covered by the
root [LICENSE.md](../../LICENSE.md).

| Material | License |
| --- | --- |
| Source code | [MIT](#1-source-code--mit) |
| Data | [ODbL 1.0](#2-data--odbl-10) |
| Basemap tiles | [© OpenStreetMap contributors, ODbL 1.0](#3-basemap-tiles--openstreetmap-contributors) |
| Creative assets made by Shiori Labs | [All rights reserved, Commute only](#4-creative-assets--all-rights-reserved) |
| Third-party glyphs and sprites | [Their own licenses](#5-third-party-glyphs-and-sprites) |

## 1. Source code — MIT

Everything in `apps/shirase` that sections 2 to 5 don't cover is source code
and is licensed under the MIT License. This includes the worker (`src/`), the
scripts (`scripts/`), and the MapLibre styles the worker generates at
`/styles/{theme}.json`.

```
MIT License

Copyright (c) 2026 Shiori Labs

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

The generated styles are built from the layer definitions in
[`@protomaps/basemaps`](https://github.com/protomaps/basemaps), and the worker
reads archives with [`pmtiles`](https://github.com/protomaps/PMTiles). Both are
BSD-3-Clause, © Protomaps LLC, and keep that license. Other dependencies are
under their own licenses, as listed in their packages.

## 2. Data — ODbL 1.0

Data that Shiori Labs authors for shirase is licensed under the
[Open Database License (ODbL) v1.0](https://opendatacommons.org/licenses/odbl/1-0/).
You may share it, build derivative databases from it, and adapt it, as long as
you attribute it, share derivative databases under the same license, and keep
them open.

The license applies to each database as a whole. The full text is at
<https://opendatacommons.org/licenses/odbl/1-0/>.

## 3. Basemap tiles — © OpenStreetMap contributors

The vector tiles shirase serves (`*.pmtiles` and every
`/{tileset}/{z}/{x}/{y}.mvt` response) are extracts of the
[Protomaps](https://protomaps.com/) basemap. They are built from:

- [OpenStreetMap](https://www.openstreetmap.org/) data, © OpenStreetMap
  contributors, available under the
  [Open Database License (ODbL) v1.0](https://opendatacommons.org/licenses/odbl/1-0/).
  See <https://www.openstreetmap.org/copyright>.
- [Natural Earth](https://www.naturalearthdata.com/) data, which is in the
  public domain.

The tiles' copyright belongs to the OpenStreetMap contributors, not to Shiori
Labs. Any map that shows them must display the attribution
"© OpenStreetMap contributors". The TileJSON's `attribution` field carries it,
and MapLibre shows it automatically. Anything derived from the tiles must stay
under the ODbL.

## 4. Creative assets — all rights reserved

Creative assets that Shiori Labs makes for shirase, such as icons, sprites and
typographic or cartographic artwork, are © Shiori Labs, all rights reserved.

This repository grants no license to them. They may be used only as part of
Commute. Any other use, copying or redistribution needs permission from
Shiori Labs.

None exist yet. Everything shirase currently serves under `/fonts/` and
`/sprites/` is third-party (section 5).

## 5. Third-party glyphs and sprites

These files come from other creators. They keep their own licenses and are not
relicensed by this file.

### PT Sans and PT Sans Narrow glyphs

The glyph files under `/fonts/` are converted from PT Sans and PT Sans Narrow.

```
Copyright (c) 2010, ParaType Ltd. (http://www.paratype.com/public),
with Reserved Font Names "PT Sans" and "ParaType".
```

They are licensed under the SIL Open Font License, Version 1.1 (section 6).
Commute uses these typefaces because JakLingko's design guideline specifies
them.

### Map sprites

The sprite sheets under `/sprites/` come from
[protomaps/basemaps-assets](https://github.com/protomaps/basemaps-assets). They
are derived from [tangrams/icons](https://github.com/tangrams/icons),
Copyright (c) 2017 Mapzen, licensed under the
[MIT License](https://github.com/tangrams/icons/blob/master/LICENSE.md).

## 6. SIL Open Font License 1.1

```
-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```
