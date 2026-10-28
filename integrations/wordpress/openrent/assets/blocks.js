/* global window -- the editor script runs in the browser. */
/**
 * OpenRent blocks in the editor: pick a product or category; the page shows OpenRent's widget there. The
 * editor shows a placeholder, since the widget runs on the published page.
 */
( function ( wp ) {
	const { registerBlockType } = wp.blocks;
	const { createElement: h, useState, useEffect } = wp.element;
	const { Placeholder, SelectControl, TextControl, RangeControl, Spinner, Notice } = wp.components;
	const { useBlockProps } = wp.blockEditor;
	const { __, sprintf } = wp.i18n;
	const apiFetch = wp.apiFetch;

	/** The shop's products or categories, once per page. */
	const cache = {};
	function useList( kind ) {
		const [ state, setState ] = useState( cache[ kind ] || { loading: true } );
		useEffect( () => {
			if ( cache[ kind ] ) return;
			apiFetch( { path: '/openrent/v1/' + kind } )
				.then( ( items ) => setState( ( cache[ kind ] = { items } ) ) )
				.catch( ( error ) => setState( { error: error.message } ) );
		}, [ kind ] );
		return state;
	}

	function Picker( { kind, label, value, onChange, allLabel } ) {
		const list = useList( kind );
		if ( list.loading ) return h( Spinner );
		if ( list.error ) return h( Notice, { status: 'warning', isDismissible: false }, list.error );
		const options = list.items.map( ( i ) => ( { label: i.name, value: i.slug } ) );
		return h( SelectControl, {
			label,
			value,
			options: [ { label: allLabel, value: '' } ].concat( options ),
			onChange,
			__nextHasNoMarginBottom: true,
		} );
	}

	const icon = 'store';

	registerBlockType( 'openrent/product', {
		apiVersion: 3,
		title: __( 'OpenRent product', 'openrent' ),
		description: __( 'A rental product with its prices and booking.', 'openrent' ),
		category: 'widgets',
		icon,
		attributes: { product: { type: 'string', default: '' } },
		edit( { attributes, setAttributes } ) {
			return h(
				'div',
				useBlockProps(),
				h(
					Placeholder,
					{ icon, label: __( 'OpenRent product', 'openrent' ), instructions: __( 'Visitors see the product here, and book it.', 'openrent' ) },
					h( Picker, { kind: 'products', label: __( 'Product', 'openrent' ), value: attributes.product, allLabel: __( 'Choose a product', 'openrent' ), onChange: ( product ) => setAttributes( { product } ) } )
				)
			);
		},
		save: () => null,
	} );

	registerBlockType( 'openrent/category', {
		apiVersion: 3,
		title: __( 'OpenRent category', 'openrent' ),
		description: __( 'The rental products of a category, or all of them.', 'openrent' ),
		category: 'widgets',
		icon,
		attributes: { category: { type: 'string', default: '' }, limit: { type: 'number', default: 12 } },
		edit( { attributes, setAttributes } ) {
			return h(
				'div',
				useBlockProps(),
				h(
					Placeholder,
					{ icon, label: __( 'OpenRent category', 'openrent' ), instructions: __( 'Visitors see these products here, and book them.', 'openrent' ) },
					h( Picker, { kind: 'categories', label: __( 'Category', 'openrent' ), value: attributes.category, allLabel: __( 'All products', 'openrent' ), onChange: ( category ) => setAttributes( { category } ) } ),
					h( RangeControl, { label: __( 'Products shown', 'openrent' ), min: 1, max: 48, value: attributes.limit, onChange: ( limit ) => setAttributes( { limit } ), __nextHasNoMarginBottom: true } )
				)
			);
		},
		save: () => null,
	} );

	registerBlockType( 'openrent/book-button', {
		apiVersion: 3,
		title: __( 'OpenRent book button', 'openrent' ),
		description: __( 'A button to a product, or to the shop, on your storefront.', 'openrent' ),
		category: 'widgets',
		icon: 'button',
		attributes: { product: { type: 'string', default: '' }, label: { type: 'string', default: '' } },
		edit( { attributes, setAttributes } ) {
			return h(
				'div',
				useBlockProps(),
				h(
					Placeholder,
					{
						icon: 'button',
						label: __( 'OpenRent book button', 'openrent' ),
						/* translators: %s: the button's text. */
						instructions: sprintf( __( 'A button reading “%s”.', 'openrent' ), attributes.label || __( 'Book now', 'openrent' ) ),
					},
					h( Picker, { kind: 'products', label: __( 'Product', 'openrent' ), value: attributes.product, allLabel: __( 'The whole shop', 'openrent' ), onChange: ( product ) => setAttributes( { product } ) } ),
					h( TextControl, { label: __( 'Button text', 'openrent' ), value: attributes.label, placeholder: __( 'Book now', 'openrent' ), onChange: ( label ) => setAttributes( { label } ), __nextHasNoMarginBottom: true } )
				)
			);
		},
		save: () => null,
	} );
} )( window.wp );
