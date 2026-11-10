import './locale';
import { mount } from 'svelte';
import ConfirmDialog from './confirm/ConfirmDialog.svelte';
import './app.css';

mount(ConfirmDialog, { target: document.getElementById('app')! });
