package id.shiorilabs.commute.feature.trip.presentation

import id.shiorilabs.commute.core.trip.Headline
import id.shiorilabs.commute.core.trip.headline
import id.shiorilabs.commute.feature.trip.ActiveTrip

internal fun ActiveTrip.headline(): Headline = state.headline(plan)
