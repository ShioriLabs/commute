package id.shiorilabs.commute.feature.journey.presentation.savedroute

import id.shiorilabs.commute.core.datastore.StoredFareCriteria
import id.shiorilabs.commute.feature.journey.domain.Departure
import id.shiorilabs.commute.feature.journey.domain.JourneyCriteria
import id.shiorilabs.commute.feature.journey.domain.toCriteria
import java.time.Instant

/**
 * What a pinned pair's card on home asks with: the rider's stored settings, but departing now
 * whatever the OTW search has picked, as home answers "what leaves now". The card and the startup
 * warm-up must ask alike, or the warm-up reads in an answer the card never looks for.
 */
internal fun StoredFareCriteria?.homeRouteCriteria(now: Instant): JourneyCriteria =
    toCriteria(now).copy(departure = Departure.Now)
