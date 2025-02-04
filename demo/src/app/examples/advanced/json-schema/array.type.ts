import { Component } from '@angular/core';
import { FieldArrayType } from '@ngx-formly/core';

@Component({
  selector: 'formly-array-type',
  template: `
    <legend *ngIf="to.label">{{ to.label }}</legend>
    <p *ngIf="to.description">{{ to.description }}</p>
    <div *ngFor="let field of field.fieldGroup;let i = index;" class="row">
      <formly-field class="col-sm-10" [field]="field"></formly-field>
      <div class="col-sm-2">
        <button class="btn btn-danger" type="button" (click)="remove(i)">Remove</button>
      </div>
    </div>
    <div class="row">
      <div class="col-sm-2 offset-sm-10">
        <button class="btn btn-primary" type="button" (click)="add()">Add</button>
      </div>
    <div>
  `,
})
export class ArrayTypeComponent extends FieldArrayType {}
