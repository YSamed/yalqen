import './locale';
import { mount } from 'svelte';
import LinkPeek from './peek/LinkPeek.svelte';
import './app.css';

mount(LinkPeek, { target: document.getElementById('app')! });
