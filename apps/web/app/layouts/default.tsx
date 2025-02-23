import { Outlet } from 'react-router'

export default function DefaultLayout() {
  return (
    <>
      {/* <header className="sticky p-4">
          <span className="font-bold">Commute</span>
        </header> */}
      <div>
        <Outlet />
      </div>
    </>
  )
}
