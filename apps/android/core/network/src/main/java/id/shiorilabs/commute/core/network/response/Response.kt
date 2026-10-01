package id.shiorilabs.commute.core.network.response

import kotlinx.serialization.Serializable

/**
 * The envelope every successful response is wrapped in: `{ "status": 200, "data": … }`.
 *
 * Hand-written, unlike the models it carries: the OpenAPI document inlines the envelope into each
 * route rather than naming it, so there is nothing generic to generate. [T] is always a generated
 * type from `:core:model`.
 *
 * @property status Mirrors the HTTP status code.
 */
@Serializable
data class Response<T>(
    val status: Int,
    val data: T,
)
