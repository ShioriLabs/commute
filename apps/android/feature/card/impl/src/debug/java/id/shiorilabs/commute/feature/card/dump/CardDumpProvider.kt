package id.shiorilabs.commute.feature.card.dump

import androidx.core.content.FileProvider

/**
 * Its own class so the manifest merger keeps it apart from the trip log's provider: two
 * `<provider>`s naming FileProvider itself merge into one, and clash.
 */
class CardDumpProvider : FileProvider()
