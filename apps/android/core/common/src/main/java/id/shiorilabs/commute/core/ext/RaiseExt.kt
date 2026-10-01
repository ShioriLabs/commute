package id.shiorilabs.commute.core.ext

import arrow.core.Either
import arrow.core.raise.Raise
import arrow.core.raise.catch
import arrow.core.raise.either
import id.shiorilabs.commute.core.type.Failure
import id.shiorilabs.commute.core.type.toFailure

/**
 * Runs [block] and returns its result, or raises [map] applied to any thrown [Throwable].
 *
 * The pair of [map] plus the surrounding `Raise<E>` scope determines the error type, so this
 * helper works for any feature-specific failure type that has a `Throwable -> E` mapper.
 *
 * ```
 * suspend fun foo(): Either<LoginFailure, Bar> = either {
 *     val data = catchTo(Throwable::toLoginFailure) { service.foo().data }
 *     Bar(data.x, data.y)
 * }
 * ```
 *
 * @param map Converts a thrown [Throwable] into the raised error [E].
 * @param block The code to run.
 */
inline fun <E, A> Raise<E>.catchTo(map: (Throwable) -> E, block: () -> A): A = catch(
    block = block,
    catch = { raise(map(it)) },
)

/**
 * Runs [block] and returns its result, or raises [toFailure] applied to any thrown [Throwable].
 *
 * Specialisation of [catchTo] for the shared [Failure] taxonomy.
 *
 * ```
 * suspend fun foo(): Either<Failure, Bar> = either {
 *     val data = catchToFailure { service.foo().data }
 *     Bar(data.x, data.y)
 * }
 * ```
 */
inline fun <A> Raise<Failure>.catchToFailure(block: () -> A): A =
    catchTo(Throwable::toFailure, block)

/**
 * The canonical repository call: runs [block] on the data dispatcher, wraps it in an [either] block,
 * and maps any thrown [Throwable] to the error type via [map].
 *
 * Collapses the `onDataThread { either { catchTo(map) { … } } }` boilerplate that every repository
 * method otherwise repeats:
 *
 * ```
 * override suspend fun login(...): Either<LoginFailure, Login> =
 *     apiCall(Throwable::toLoginFailure) {
 *         val data = service.login(LoginRequest(username, password)).data
 *         Login(data.accessToken, data.expiresIn, data.tokenType)
 *     }
 * ```
 *
 * Use the explicit `onDataThread { either { … } }` form instead when the method needs the surrounding
 * `Raise` scope between the call and the result (e.g. an `ensure(...)` on the decoded response).
 *
 * @param map Converts a thrown [Throwable] into the raised error [E].
 * @param block The repository work — typically a service call plus DTO→domain mapping.
 */
suspend fun <E, A> apiCall(map: (Throwable) -> E, block: suspend () -> A): Either<E, A> =
    onDataThread { either { catchTo(map) { block() } } }

/**
 * Specialisation of [apiCall] for the shared [Failure] taxonomy.
 *
 * ```
 * override suspend fun fetch(): Either<Failure, List<Searchable>> = apiCallToFailure { service.getSearchables().data.toSearchables() }
 * ```
 */
suspend fun <A> apiCallToFailure(block: suspend () -> A): Either<Failure, A> =
    apiCall(Throwable::toFailure, block)
