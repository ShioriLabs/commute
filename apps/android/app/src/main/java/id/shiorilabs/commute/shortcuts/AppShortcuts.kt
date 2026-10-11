package id.shiorilabs.commute.shortcuts

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import androidx.core.net.toUri
import dagger.hilt.android.qualifiers.ApplicationContext
import id.shiorilabs.commute.MainActivity
import id.shiorilabs.commute.R
import id.shiorilabs.commute.core.datastore.SavedEntry
import id.shiorilabs.commute.core.datastore.SavedRepository
import id.shiorilabs.commute.core.query.di.ApplicationScope
import id.shiorilabs.commute.feature.station.data.StationRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The launcher icon's long-press menu: the rider's pinned pairs and stations ([buildShortcutSpecs]
 * says which), then OTW. Each opens as the web link it stands for, through the activity's own link
 * handling, so there is no routing of its own here.
 *
 * All dynamic: static shortcuts always list before dynamic ones, which would put OTW first.
 */
@Singleton
class AppShortcuts @Inject constructor(
    @ApplicationContext private val context: Context,
    private val savedRepository: SavedRepository,
    private val stationRepository: StationRepository,
    @ApplicationScope private val scope: CoroutineScope,
) {

    /** Republishes the menu now and whenever the pinned list changes. Call once. */
    fun start() {
        scope.launch {
            savedRepository.entries.distinctUntilChanged().collectLatest { entries ->
                try {
                    publish(entries)
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (_: Exception) {
                    // A menu that can't be set (rate limited, launcher gone) is only a missing menu.
                }
            }
        }
    }

    private suspend fun publish(entries: List<SavedEntry>) {
        val slots = ShortcutManagerCompat.getMaxShortcutCountPerActivity(context)
        val specs = buildShortcutSpecs(
            entries = entries,
            names = namesOf(entries),
            otwLabel = context.getString(R.string.shortcut_otw),
            slots = slots,
        )
        ShortcutManagerCompat.setDynamicShortcuts(
            context,
            specs.mapIndexed { index, spec -> spec.toShortcut(index) },
        )
    }

    /** Names of the stations [entries] pins: held ones at once, the rest asked for. */
    private suspend fun namesOf(entries: List<SavedEntry>): Map<String, String> = coroutineScope {
        entries.flatMap {
            when (it) {
                is SavedEntry.Station -> listOf(it.stationId)
                is SavedEntry.Route -> listOf(it.fromId, it.toId)
            }
        }.distinct().map { id ->
            async {
                val name = stationRepository.cachedStation(id)?.name
                    ?: stationRepository.station(id).getOrNull()?.name
                name?.let { id to it }
            }
        }.awaitAll().filterNotNull().toMap()
    }

    private fun ShortcutSpec.toShortcut(rank: Int): ShortcutInfoCompat {
        val icon = when (kind) {
            ShortcutKind.Route -> R.drawable.ic_shortcut_route
            ShortcutKind.Station -> R.drawable.ic_shortcut_station
            ShortcutKind.Otw -> R.drawable.ic_shortcut_otw
        }
        return ShortcutInfoCompat.Builder(context, id)
            .setShortLabel(label)
            .setLongLabel(label)
            .setIcon(IconCompat.createWithResource(context, icon))
            .setRank(rank)
            .setIntent(
                Intent(Intent.ACTION_VIEW, link.toUri())
                    .setComponent(ComponentName(context, MainActivity::class.java)),
            )
            .build()
    }
}
