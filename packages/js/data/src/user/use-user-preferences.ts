/**
 * External dependencies
 */
import { mapValues } from 'lodash';
import {
	useDispatch,
	useSelect,
	select as wpDataSelect,
} from '@wordpress/data';
import schema, { Schema } from 'wordpress__core-data';
import type { getEntityRecord } from 'wordpress__core-data/selectors';

/**
 * Internal dependencies
 */
import { STORE_NAME } from './constants';

type UserPreferences = {
	activity_panel_inbox_last_read?: string;
	activity_panel_reviews_last_read?: string;
	android_app_banner_dismissed?: string;
	categories_report_columns?: string;
	coupons_report_columns?: string;
	customers_report_columns?: string;
	dashboard_chart_interval?: string;
	dashboard_chart_type?: string;
	dashboard_leaderboard_rows?: string;
	dashboard_sections?: string;
	help_panel_highlight_shown?: string;
	homepage_layout?: string;
	homepage_stats?: string;
	orders_report_columns?: string;
	products_report_columns?: string;
	revenue_report_columns?: string;
	task_list_tracked_started_tasks?: {
		[ key: string ]: number;
	};
	taxes_report_columns?: string;
	variations_report_columns?: string;
};

type WoocommerceMeta = UserPreferences & {
	task_list_tracked_started_tasks?: string;
};

type WCUser = Schema.User & {
	woocommerce_meta: WoocommerceMeta;
};

/**
 * Retrieve and decode the user's WooCommerce meta values.
 *
 * @param {Object} user WP User object.
 * @return {Object} User's WooCommerce preferences.
 */
const getWooCommerceMeta = ( user: WCUser ) => {
	const wooMeta = user.woocommerce_meta || {};

	const userData = mapValues( wooMeta, ( data, key ) => {
		if ( ! data || data.length === 0 ) {
			return '';
		}
		try {
			return JSON.parse( data );
		} catch ( e ) {
			if ( e instanceof Error ) {
				/* eslint-disable no-console */
				console.error(
					`Error parsing value '${ data }' for ${ key }`,
					e.message
				);
				/* eslint-enable no-console */
			} else {
				/* eslint-disable no-console */
				console.error(
					`Unexpected Error parsing value '${ data }' for ${ key } ${ e }`
				);
				/* eslint-enable no-console */
			}
			return '';
		}
	} );

	return userData;
};

// Create wrapper for updating user's `woocommerce_meta`.
async function updateUserPrefs(
	receiveCurrentUser: ( user: WCUser ) => void,
	user: WCUser,
	saveUser: ( userToSave: {
		id: number;
		woocommerce_meta: { [ key: string ]: boolean };
	} ) => WCUser,
	getLastEntitySaveError: (
		kind: string,
		name: string,
		recordId: number
	) => unknown,
	userPrefs: UserPreferences
) {
	// @todo Handle unresolved getCurrentUser() here.
	// Prep fields for update.
	const metaData = mapValues( userPrefs, JSON.stringify );

	if ( Object.keys( metaData ).length === 0 ) {
		return {
			error: new Error( 'Invalid woocommerce_meta data for update.' ),
			updatedUser: undefined,
		};
	}

	// Optimistically propagate new woocommerce_meta to the store for instant update.
	receiveCurrentUser( {
		...user,
		woocommerce_meta: {
			...user.woocommerce_meta,
			...metaData,
		},
	} );

	// Use saveUser() to update WooCommerce meta values.
	const updatedUser = await saveUser( {
		id: user.id,
		woocommerce_meta: metaData,
	} );

	if ( undefined === updatedUser ) {
		// Return the encountered error to the caller.
		const error = getLastEntitySaveError( 'root', 'user', user.id );

		return {
			error,
			updatedUser,
		};
	}

	// Decode the WooCommerce meta after save.
	const updatedUserResponse = {
		...updatedUser,
		woocommerce_meta: getWooCommerceMeta( updatedUser ),
	};

	return {
		updatedUser: updatedUserResponse,
	};
}

/**
 * Custom react hook for retrieving thecurrent user's WooCommerce preferences.
 *
 * This is a wrapper around @wordpress/core-data's getCurrentUser() and saveUser().
 */
export const useUserPreferences = () => {
	// Get our dispatch methods now - this can't happen inside the callback below.
	const dispatch = useDispatch( STORE_NAME );
	const { addEntities, receiveCurrentUser, saveEntityRecord } = dispatch;
	let { saveUser } = dispatch;

	const userData = useSelect( ( select: typeof wpDataSelect ) => {
		const {
			getCurrentUser,
			getEntity,
			getEntityRecord,
			getLastEntitySaveError,
			hasStartedResolution,
			hasFinishedResolution,
		} = select( STORE_NAME );

		return {
			isRequesting:
				hasStartedResolution( 'getCurrentUser' ) &&
				! hasFinishedResolution( 'getCurrentUser' ),
			user: getCurrentUser(),
			getCurrentUser,
			getEntity,
			getEntityRecord,
			getLastEntitySaveError,
		};
	} );

	const updateUserPreferences = ( userPrefs: UserPreferences ) => {
		// WP 5.3.x doesn't have the User entity defined.
		if ( typeof saveUser !== 'function' ) {
			// Polyfill saveUser() - wrapper of saveEntityRecord.
			saveUser = async ( userToSave: {
				id: string;
				woocommerce_meta: { [ key: string ]: boolean };
			} ) => {
				const entityDefined = Boolean(
					userData.getEntity( 'root', 'user' )
				);
				if ( ! entityDefined ) {
					// Add the User entity so saveEntityRecord works.
					await addEntities( [
						{
							name: 'user',
							kind: 'root',
							baseURL: '/wp/v2/users',
							plural: 'users',
						},
					] );
				}

				// Fire off the save action.
				await saveEntityRecord( 'root', 'user', userToSave );

				// Respond with the updated user.
				return userData.getEntityRecord(
					'root',
					'user',
					userToSave.id
				);
			};
		}
		// Get most recent user before update.
		const currentUser = userData.getCurrentUser();
		return updateUserPrefs(
			receiveCurrentUser,
			currentUser,
			saveUser,
			userData.getLastEntitySaveError,
			userPrefs
		);
	};

	const userPreferences: UserPreferences = userData.user
		? getWooCommerceMeta( userData.user )
		: {};

	return {
		isRequesting: userData.isRequesting,
		...userPreferences,
		updateUserPreferences,
	};
};
